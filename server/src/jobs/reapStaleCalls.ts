import { fetchCallStatus, twilioErrorStatus } from '../../dependencies/twilio.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { IN_FLIGHT_STATUSES, TERMINAL_CALL_STATUSES, TWILIO_TO_CALL_STATUS } from '../lib/callStatus.js'
import { JOB_REAP_STALE_CALLS, scheduleJob, workJob } from './queue.js'

// The stale-call reaper: a scheduled sweep that settles calls the Twilio status
// webhook (routes/twilioVoice.ts POST /voice/status) never followed up on.
//
// Call state depends entirely on that webhook arriving. If one is lost — a
// deploy mid-call, a dropped tunnel, a transient 500, a signature mismatch — the
// row stays "queued" or "ringing" forever, and the double-call guard
// (routes/calls.ts → IN_FLIGHT_STATUSES) then refuses a second call to that same
// number indefinitely. This job is the backstop docs/specs/SPEC-DIALER-REBUILD.md
// (open questions, "What happens if Twilio webhook doesn't arrive?") calls for.

/**
 * How long a call can sit in a non-terminal status before the reaper considers
 * it stuck. Named per the spec's own `DIALED_STALE_MS`.
 */
export const DIALED_STALE_MS = 4 * 60 * 60 * 1000

/**
 * How often the sweep runs. Independent of the staleness threshold — this runs
 * far more often than four hours, so a call that crosses the threshold is caught
 * soon after, not up to a further four hours late.
 */
export const REAP_STALE_CALLS_CRON = '*/15 * * * *'

/**
 * The status written when a stuck call cannot be reconciled against Twilio
 * either — no SID was ever stamped, the SID is gone, or the Twilio API call
 * itself failed. A guess, not a confirmed outcome, so every write using it is
 * logged as unreconciled (`reconciledFromTwilio: false`) rather than silently
 * indistinguishable from a real Twilio-confirmed failure.
 */
const BACKSTOP_STATUS = 'failed'

/** One row old enough for the reaper to look at. */
interface StaleCallRow {
  id: string
  orgId: string
  status: string
  twilioCallSid: string | null
  updatedAt: Date
}

export interface ReapStaleCallsResult {
  /** Rows the sweep found past the threshold. */
  scanned: number
  /** Of those, how many were actually settled — the rest are calls Twilio still
   * reports as genuinely in flight, or lost a race to a real webhook. */
  settled: number
}

/**
 * Settle one stale call: reconcile it against Twilio when a SID exists, and
 * fall back to the backstop status when it doesn't or Twilio can't be reached.
 *
 * Returns false, WITHOUT writing anything, when Twilio itself still reports the
 * call in flight — that's not a lost webhook, it's a call that is (or may be)
 * genuinely still going, and forcing it closed would hang up a real
 * conversation. It is left for the next sweep to re-check.
 */
async function settleStaleCall(call: StaleCallRow, now: Date): Promise<boolean> {
  const staleForMs = now.getTime() - call.updatedAt.getTime()

  let finalStatus = BACKSTOP_STATUS
  let durationS: number | undefined
  let reconciledFromTwilio = false

  if (call.twilioCallSid) {
    try {
      const fetched = await fetchCallStatus(call.twilioCallSid)
      const mapped = TWILIO_TO_CALL_STATUS[fetched.status]

      if (mapped && !TERMINAL_CALL_STATUSES.has(mapped)) {
        logger.info(
          { callId: call.id, orgId: call.orgId, twilioStatus: fetched.status, staleForMs },
          'stale-call reaper: Twilio still reports this call in flight, leaving it for the next sweep',
        )
        return false
      }

      if (mapped) {
        finalStatus = mapped
        if (fetched.durationS !== null) durationS = fetched.durationS
        reconciledFromTwilio = true
      }
    } catch (error) {
      logger.warn(
        { callId: call.id, orgId: call.orgId, error, twilioStatus: twilioErrorStatus(error) },
        'stale-call reaper: could not reconcile against Twilio, using the backstop status',
      )
    }
  }

  // Compare-and-set on the in-flight statuses: a real webhook (or another sweep)
  // may have settled this row between the read above and this write, and that
  // outcome must win over a guess.
  const updated = await prisma.call.updateMany({
    where: { id: call.id, orgId: call.orgId, status: { in: IN_FLIGHT_STATUSES } },
    data: {
      status: finalStatus,
      endedAt: now,
      ...(durationS !== undefined ? { durationS } : {}),
    },
  })

  if (updated.count === 0) {
    logger.info(
      { callId: call.id, orgId: call.orgId },
      'stale-call reaper: call was already settled by the time this sweep got to it, skipping',
    )
    return false
  }

  logger.warn(
    {
      callId: call.id,
      orgId: call.orgId,
      previousStatus: call.status,
      settledStatus: finalStatus,
      reconciledFromTwilio,
      staleForMs,
    },
    'stale-call reaper: settled a call stuck past the staleness threshold — check for a lost Twilio webhook',
  )
  return true
}

/**
 * Find every call stuck in a non-terminal status past `DIALED_STALE_MS`, and
 * settle each one.
 *
 * Exported as a plain function, with no pg-boss types in its signature, exactly
 * like uploadRecordingJob — testable without a queue. `now` is a parameter
 * rather than read internally so a test can pin the clock.
 */
export async function reapStaleCallsJob(now: Date = new Date()): Promise<ReapStaleCallsResult> {
  const staleBefore = new Date(now.getTime() - DIALED_STALE_MS)

  const staleCalls = await prisma.call.findMany({
    where: { status: { in: IN_FLIGHT_STATUSES }, updatedAt: { lt: staleBefore } },
    select: { id: true, orgId: true, status: true, twilioCallSid: true, updatedAt: true },
  })

  let settled = 0
  for (const call of staleCalls) {
    if (await settleStaleCall(call, now)) settled += 1
  }

  return { scanned: staleCalls.length, settled }
}

/** Attach the worker. Called once, from index.ts — never from app.ts. */
export async function registerReapStaleCallsWorker(): Promise<string> {
  return workJob<Record<string, never>>(JOB_REAP_STALE_CALLS, { batchSize: 1 }, async () => {
    await reapStaleCallsJob()
  })
}

/**
 * Put the sweep on its recurring schedule. Called once, from index.ts, alongside
 * `registerReapStaleCallsWorker` — scheduling without a worker registered would
 * queue jobs nothing ever picks up.
 */
export async function scheduleReapStaleCalls(): Promise<void> {
  await scheduleJob(JOB_REAP_STALE_CALLS, REAP_STALE_CALLS_CRON)
}
