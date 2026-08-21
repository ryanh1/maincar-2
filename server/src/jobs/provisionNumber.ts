import { buyPhoneNumber, twilioErrorStatus } from '../../dependencies/twilio.js'
import { logger } from '../../dependencies/logger.js'
import { PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { JOB_PROVISION_NUMBER, sendJob, workJob } from './queue.js'

// The job that turns a PhoneNumber row from "searching" into a number Twilio has
// actually sold us and pointed at our voice webhook.
//
// This is the one background job in the codebase that SPENDS MONEY. Every read
// of it should start from that: a second successful run against the same row
// rents a second number, forever, and nothing downstream would notice.

/** Everything the job needs. The row carries the rest. */
export interface ProvisionNumberPayload {
  phoneNumberId: string
}

/**
 * Where pg-boss is in its retry budget for this run.
 *
 * Passed in rather than read from a queue handle so the handler stays a plain
 * function a test can call directly.
 */
export interface ProvisionNumberAttempt {
  /** Retries already spent. 0 on the first run. */
  retryCount: number
  /** The ceiling from the queue/send options. */
  retryLimit: number
}

/** One retry, then the row is marked failed. Mirrors the queue default. */
export const PROVISION_NUMBER_RETRY_LIMIT = 1

/** Seconds pg-boss waits before the retry — long enough for a Twilio blip to pass. */
export const PROVISION_NUMBER_RETRY_DELAY_SECONDS = 30

/** The path Twilio POSTs to when a call arrives on one of our numbers. */
export const VOICE_WEBHOOK_PATH = '/api/twilio/voice'

/**
 * Raised when PUBLIC_BASE_URL is not configured.
 *
 * Named, and thrown, rather than tolerated: a webhook URL built from an empty
 * base is `"/api/twilio/voice"`, which Twilio accepts as a relative URL and then
 * cannot ever reach. That buys a number that silently drops every inbound call —
 * strictly worse than not buying one at all.
 */
export class WebhookBaseUrlMissingError extends Error {
  constructor() {
    super(
      'PUBLIC_BASE_URL is not set, so no Twilio voice webhook URL can be built. ' +
        'Set it to the public origin this API is reachable on (see .env.example).',
    )
    this.name = 'WebhookBaseUrlMissingError'
  }
}

/** The absolute voice webhook URL. Throws rather than return a hostless path. */
export function voiceWebhookUrl(): string {
  if (!PUBLIC_BASE_URL) throw new WebhookBaseUrlMissingError()
  return `${PUBLIC_BASE_URL}${VOICE_WEBHOOK_PATH}`
}

/**
 * Should this failure be retried?
 *
 * The split matters more here than in most jobs, because "retry" means "try to
 * spend money again":
 *
 *   - No HTTP status at all — DNS, a dropped socket, a timeout. The request may
 *     never have reached Twilio, or the answer may have been lost on the way
 *     back. Transient.
 *   - 429 — Twilio throttled us. It clears on its own. Transient.
 *   - 5xx — Twilio's own side broke. Transient.
 *   - Any other 4xx — Twilio read the request and rejected it: the number was
 *     sold to someone else a second ago, the E.164 is malformed, the account is
 *     not permitted to buy in that country. A retry replays the identical
 *     request and earns the identical rejection. PERMANENT.
 *
 * A missing Twilio credential also arrives with no status and is therefore
 * treated as transient. That costs one wasted retry and then lands in "failed"
 * with the credential error logged, which is the honest outcome — the job cannot
 * tell a missing env var from a dead socket, and guessing wrong in the other
 * direction would drop real retryable failures on the floor.
 */
function isTransientTwilioFailure(status: number | null): boolean {
  if (status === null) return true
  return status === 429 || status >= 500
}

/**
 * Mark the row failed.
 *
 * `updateMany` with orgId, never `update({ where: { id } })` — the org filter is
 * defence in depth even here, where the id came off a row this process just
 * read. The `status: "searching"` clause makes it a compare-and-set: if anything
 * else already settled the row, this writes nothing rather than dragging an
 * active number back to failed.
 */
async function markFailed(id: string, orgId: string): Promise<void> {
  await prisma.phoneNumber.updateMany({
    where: { id, orgId, status: 'searching' },
    data: { status: 'failed' },
  })
}

/**
 * Buy and configure the number for one PhoneNumber row.
 *
 * Exported as a plain function, with no pg-boss types in its signature, so the
 * whole decision tree is unit-testable without a queue.
 *
 * Contract with the queue:
 *   - returns normally  → the job is settled, do not retry
 *   - throws            → pg-boss retries, up to `attempt.retryLimit`
 */
export async function provisionNumberJob(
  payload: ProvisionNumberPayload,
  attempt: ProvisionNumberAttempt = {
    retryCount: 0,
    retryLimit: PROVISION_NUMBER_RETRY_LIMIT,
  },
): Promise<void> {
  const { phoneNumberId } = payload

  // --- Load the row ---
  //
  // By id alone, with no orgId filter, because a job has no caller and no token
  // to take one from. The id is not user input: it came from a row this server
  // wrote, and the orgId read back here is what every write below is scoped to.
  const row = await prisma.phoneNumber.findUnique({
    where: { id: phoneNumberId },
    select: { id: true, orgId: true, e164: true, status: true },
  })

  if (!row) {
    // The row was deleted between enqueue and pickup. Nothing to buy, nothing to
    // update, and no amount of retrying brings it back.
    logger.warn({ phoneNumberId }, 'provision number: row is gone, nothing to provision')
    return
  }

  // --- Idempotency guard: the expensive failure mode ---
  //
  // pg-boss is at-least-once. A worker that dies after Twilio charged us but
  // before the row was updated leaves the job to be delivered again, and a
  // second `buyPhoneNumber` for the same row rents a SECOND number that no user
  // asked for and no code path will ever release.
  //
  // "searching" is the only state that has not yet been paid for, so it is the
  // only state this job will act on.
  if (row.status !== 'searching') {
    logger.info(
      { phoneNumberId, orgId: row.orgId, status: row.status },
      'provision number: row is already settled, skipping the purchase',
    )
    return
  }

  // --- Build the webhook URL BEFORE spending anything ---
  let voiceUrl: string
  try {
    voiceUrl = voiceWebhookUrl()
  } catch (error) {
    // A configuration problem, not a Twilio problem. Retrying cannot set an env
    // var, so this settles immediately and never reaches the purchase.
    logger.error(
      { phoneNumberId, orgId: row.orgId, error },
      'provision number: cannot build the voice webhook URL',
    )
    await markFailed(row.id, row.orgId)
    return
  }

  // --- Buy and configure it, in one Twilio call ---
  let purchased
  try {
    purchased = await buyPhoneNumber({ e164: row.e164, voiceUrl })
  } catch (error) {
    const twilioStatus = twilioErrorStatus(error)
    const retryable =
      isTransientTwilioFailure(twilioStatus) && attempt.retryCount < attempt.retryLimit

    if (retryable) {
      // Leave the row in "searching" and rethrow: pg-boss owns the retry, and the
      // guard above will still hold if the first attempt did in fact succeed.
      logger.warn(
        { phoneNumberId, orgId: row.orgId, twilioStatus, retryCount: attempt.retryCount, error },
        'provision number: transient Twilio failure, handing it back to the queue',
      )
      throw error
    }

    // Permanent, or transient with the retry budget spent. Either way this row
    // is done. Note what is NOT in this log line: no auth token, no account SID.
    logger.error(
      { phoneNumberId, orgId: row.orgId, twilioStatus, retryCount: attempt.retryCount, error },
      'provision number: Twilio would not sell this number',
    )
    await markFailed(row.id, row.orgId)
    return
  }

  // --- Record it ---
  //
  // One update, and only now: `status` and `twilioSid` are written together, with
  // a SID Twilio actually returned. Nothing above this line ever writes "active"
  // speculatively, so a row is never active without the number behind it.
  //
  // `status: "searching"` in the filter again, so a duplicate delivery that got
  // past the guard above still cannot overwrite a settled row.
  const updated = await prisma.phoneNumber.updateMany({
    where: { id: row.id, orgId: row.orgId, status: 'searching' },
    data: { status: 'active', twilioSid: purchased.sid },
  })

  if (updated.count === 0) {
    // The purchase went through but another writer moved the row first. Log it
    // loudly — this is the shape a leaked, paid-for number would have.
    logger.error(
      { phoneNumberId, orgId: row.orgId },
      'provision number: bought the number but the row was no longer searching',
    )
    return
  }

  logger.info({ phoneNumberId, orgId: row.orgId }, 'provision number: active')
}

/**
 * Enqueue a provisioning run for one row.
 *
 * This is the whole public surface a route needs: write the PhoneNumber row with
 * status "searching", then call this. Everything about how the number gets bought
 * stays behind it.
 */
export async function queueProvisionNumber(phoneNumberId: string): Promise<string | null> {
  const payload: ProvisionNumberPayload = { phoneNumberId }
  return sendJob(JOB_PROVISION_NUMBER, payload, {
    retryLimit: PROVISION_NUMBER_RETRY_LIMIT,
    retryDelay: PROVISION_NUMBER_RETRY_DELAY_SECONDS,
  })
}

/**
 * Attach the worker. Called once, from index.ts — never from app.ts.
 *
 * `batchSize: 1` because each job makes its own Twilio purchase; there is nothing
 * to gain from fetching several at once and a partial batch failure would be
 * harder to reason about than a queue of singles.
 */
export async function registerProvisionNumberWorker(): Promise<string> {
  return workJob<ProvisionNumberPayload>(JOB_PROVISION_NUMBER, { batchSize: 1 }, async (job) => {
    await provisionNumberJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
