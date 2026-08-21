import { releasePhoneNumber, twilioErrorStatus } from '../../dependencies/twilio.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { JOB_RELEASE_NUMBER, sendJob, workJob } from './queue.js'

// The job that gives a number back to Twilio and then removes its row.
//
// The mirror image of jobs/provisionNumber.ts, and the asymmetry between them is
// the thing to hold on to. Provisioning fails SAFE: a purchase that never happens
// costs nothing, so it gives up early rather than risk buying twice. Releasing
// fails EXPENSIVE: a release that never happens leaves the org paying monthly for
// a number it has already given up and can no longer see. So this job tries
// harder, and only stops trying once Twilio has answered in a way no retry can
// change.

/** Everything the job needs. The row carries the rest. */
export interface ReleaseNumberPayload {
  phoneNumberId: string
}

/**
 * Where pg-boss is in its retry budget for this run.
 *
 * Passed in rather than read from a queue handle so the handler stays a plain
 * function a test can call directly.
 */
export interface ReleaseNumberAttempt {
  /** Retries already spent. 0 on the first run. */
  retryCount: number
  /** The ceiling from the queue/send options. */
  retryLimit: number
}

/** Three retries, a minute apart. Mirrors the queue default. */
export const RELEASE_NUMBER_RETRY_LIMIT = 3

/** Seconds pg-boss waits before each retry. */
export const RELEASE_NUMBER_RETRY_DELAY_SECONDS = 60

/**
 * The one status this job acts on.
 *
 * The route moves the row here before enqueuing, so a row in any other state is
 * either not ours to touch or has already been settled by an earlier delivery.
 */
const RELEASING_STATUS = 'releasing'

/**
 * Where a row goes when Twilio refuses to release it for good.
 *
 * "active" is the honest answer, not a tidy one: the org is still renting the
 * number, so the row has to say so. It is also the one status the release route
 * accepts, which makes the failure RETRYABLE by the person who asked — a row
 * stranded in "releasing" would be a number nobody could ever get rid of, which
 * is the bug this whole issue is about.
 *
 * `isActiveForOutbound` is deliberately NOT restored. The route cleared it on the
 * way in, and a number that spent time half-released must not silently become
 * somebody's caller ID again; they pick it back up on purpose or not at all.
 */
const GIVE_UP_STATUS = 'active'

/**
 * Should this failure be retried?
 *
 * The same split provisionNumber.ts makes, weighed the other way round:
 *
 *   - No HTTP status at all — DNS, a dropped socket, a timeout. Transient.
 *   - 429 — Twilio throttled us. Transient.
 *   - 5xx — Twilio's own side broke. Transient.
 *   - Any other 4xx — Twilio read the request and rejected it. A retry replays
 *     the identical request and earns the identical rejection. PERMANENT.
 *
 * 404 never reaches here: `releaseNumberJob` treats it as success before asking,
 * because a number Twilio does not have is a number nobody is being billed for.
 */
function isTransientTwilioFailure(status: number | null): boolean {
  if (status === null) return true
  return status === 429 || status >= 500
}

/**
 * Drop the row, now that Twilio is no longer renting us the number.
 *
 * `deleteMany` with orgId, never `delete({ where: { id } })` — the org filter is
 * defence in depth even here, where the id came off a row this process just read.
 * The status clause makes it a compare-and-set: a row something else has already
 * moved is left alone rather than deleted out from under whoever moved it.
 *
 * The row goes rather than gaining a fifth "released" status, because call and
 * text history stores the E.164 raw and holds no foreign key to this table
 * (schema.prisma → THE VOICE BOUNDARY). Nothing loses its history when the row
 * goes, and a released row left lying in the list would be one more state every
 * reader of the table has to learn.
 */
async function removeRow(id: string, orgId: string): Promise<void> {
  await prisma.phoneNumber.deleteMany({
    where: { id, orgId, status: RELEASING_STATUS },
  })
}

/**
 * Release the number for one PhoneNumber row, then delete the row.
 *
 * Exported as a plain function, with no pg-boss types in its signature, so the
 * whole decision tree is unit-testable without a queue.
 *
 * Contract with the queue:
 *   - returns normally  → the job is settled, do not retry
 *   - throws            → pg-boss retries, up to `attempt.retryLimit`
 */
export async function releaseNumberJob(
  payload: ReleaseNumberPayload,
  attempt: ReleaseNumberAttempt = {
    retryCount: 0,
    retryLimit: RELEASE_NUMBER_RETRY_LIMIT,
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
    select: { id: true, orgId: true, status: true, twilioSid: true },
  })

  if (!row) {
    // An earlier delivery of this same job already released the number and
    // deleted the row. Nothing left to do, and nothing a retry could recover.
    logger.info({ phoneNumberId }, 'release number: row is already gone')
    return
  }

  // --- Idempotency guard ---
  //
  // pg-boss is at-least-once, so this handler can run twice for one row. Unlike
  // its buying twin, a second release is not expensive — Twilio answers 404 and
  // the row is already gone — but acting on a row somebody has since moved back
  // to "active" WOULD be: it would release a number the org has decided to keep.
  if (row.status !== RELEASING_STATUS) {
    logger.info(
      { phoneNumberId, orgId: row.orgId, status: row.status },
      'release number: row is no longer releasing, skipping',
    )
    return
  }

  // --- Nothing to release ---
  //
  // No SID means Twilio never sold us this number: the row is a purchase that
  // failed, and the person is clearing it out of their list. There is no charge
  // to stop and nothing to ask Twilio, so the row just goes.
  if (!row.twilioSid) {
    await removeRow(row.id, row.orgId)
    logger.info({ phoneNumberId, orgId: row.orgId }, 'release number: nothing was ever bought')
    return
  }

  // --- Hand it back to Twilio ---
  try {
    await releasePhoneNumber(row.twilioSid)
  } catch (error) {
    const twilioStatus = twilioErrorStatus(error)

    // 404 is success wearing a different hat: Twilio does not have this number
    // under our account, so nobody is being billed for it, which is the entire
    // point of the job. Falling through to the delete is what makes a retry after
    // a lost response safe.
    if (twilioStatus !== 404) {
      const retryable =
        isTransientTwilioFailure(twilioStatus) && attempt.retryCount < attempt.retryLimit

      if (retryable) {
        // Leave the row in "releasing" and rethrow: pg-boss owns the retry, and
        // the guard above still holds if this attempt did in fact succeed.
        logger.warn(
          { phoneNumberId, orgId: row.orgId, twilioStatus, retryCount: attempt.retryCount, error },
          'release number: transient Twilio failure, handing it back to the queue',
        )
        throw error
      }

      // Permanent, or transient with the retry budget spent. The number is still
      // rented, so this logs at error level: it is a bill nobody asked for, and
      // the only remaining fix is a person. Note what is NOT in this line: no
      // auth token, no account SID, and not the number itself.
      logger.error(
        { phoneNumberId, orgId: row.orgId, twilioStatus, retryCount: attempt.retryCount, error },
        'release number: Twilio would not release this number, it is still being billed',
      )
      await prisma.phoneNumber.updateMany({
        where: { id: row.id, orgId: row.orgId, status: RELEASING_STATUS },
        data: { status: GIVE_UP_STATUS },
      })
      return
    }

    logger.warn(
      { phoneNumberId, orgId: row.orgId },
      'release number: Twilio no longer has this number, treating it as released',
    )
  }

  // --- Remove the row ---
  await removeRow(row.id, row.orgId)

  logger.info({ phoneNumberId, orgId: row.orgId }, 'release number: released')
}

/**
 * Enqueue a release for one row.
 *
 * This is the whole public surface a route needs: move the PhoneNumber row to
 * status "releasing", then call this.
 */
export async function queueReleaseNumber(phoneNumberId: string): Promise<string | null> {
  const payload: ReleaseNumberPayload = { phoneNumberId }
  return sendJob(JOB_RELEASE_NUMBER, payload, {
    retryLimit: RELEASE_NUMBER_RETRY_LIMIT,
    retryDelay: RELEASE_NUMBER_RETRY_DELAY_SECONDS,
  })
}

/**
 * Attach the worker. Called once, from index.ts — never from app.ts.
 *
 * `batchSize: 1` for the same reason provisioning uses it: each job makes its own
 * Twilio call, there is nothing to gain from fetching several at once, and a
 * partial batch failure would be harder to reason about than a queue of singles.
 */
export async function registerReleaseNumberWorker(): Promise<string> {
  return workJob<ReleaseNumberPayload>(JOB_RELEASE_NUMBER, { batchSize: 1 }, async (job) => {
    await releaseNumberJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
