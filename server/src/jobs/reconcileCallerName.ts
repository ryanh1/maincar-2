import {
  reconcileCallerNameRegistration,
  submitCallerNameRegistration,
  type CallerNameRegistrationResult,
} from '../../dependencies/callerNameRegistration.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { JOB_RECONCILE_CALLER_NAME, sendJob, sendJobAfter, workJob } from './queue.js'

/** Everything the job needs. The row carries the desired name and carrier id. */
export interface ReconcileCallerNamePayload {
  phoneNumberId: string
}

/** Two retries give a transient provider error a chance to settle without retrying forever. */
export const CALLER_NAME_RETRY_LIMIT = 2
export const CALLER_NAME_RETRY_DELAY_SECONDS = 60
export const CALLER_NAME_RECONCILIATION_DELAY_SECONDS = 300

type CallerNameRow = {
  id: string
  orgId: string
  assignedUserId: string | null
  e164: string
  twilioSid: string | null
  status: string
  isActiveForOutbound: boolean
  callerName: string | null
  callerNameStatus: string
  isCallerNameRequested: boolean
  callerNameRequestId: string | null
}

const ACTIVE_NUMBER_ERROR = 'Make this number your active outbound number, then save the caller-ID name again.'
const PROVIDER_ERROR = 'The carrier could not process the caller-ID name. Save it again to retry.'

/** Build a compare-and-set filter so an older job cannot overwrite newer preferences. */
function pendingRequestWhere(row: CallerNameRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    callerNameStatus: 'pending',
    isCallerNameRequested: true,
    callerName: row.callerName,
    callerNameRequestId: row.callerNameRequestId,
  }
}

async function recordOutcome(row: CallerNameRow, result: CallerNameRegistrationResult): Promise<void> {
  const data =
    result.kind === 'pending'
      ? { callerNameStatus: 'pending', callerNameRequestId: result.requestId, callerNameFailureReason: null }
      : result.kind === 'active'
        ? { callerNameStatus: 'active', callerNameFailureReason: null }
        : { callerNameStatus: result.kind, callerNameFailureReason: result.reason }

  await prisma.phoneNumber.updateMany({ where: pendingRequestWhere(row), data })
}

/**
 * Submit a pending caller-name request or reconcile its existing carrier id.
 *
 * The job is safe for pg-boss's at-least-once delivery: it only acts on an
 * unchanged pending request, and every write is a compare-and-set on that
 * request's desired name and identifier. It never writes the outbound-number
 * selection, so a provider failure cannot change who calls from which number.
 */
export async function reconcileCallerNameJob(
  payload: ReconcileCallerNamePayload,
  attempt: { retryCount: number; retryLimit: number } = {
    retryCount: 0,
    retryLimit: CALLER_NAME_RETRY_LIMIT,
  },
): Promise<void> {
  const row = await prisma.phoneNumber.findUnique({
    where: { id: payload.phoneNumberId },
    select: {
      id: true,
      orgId: true,
      assignedUserId: true,
      e164: true,
      twilioSid: true,
      status: true,
      isActiveForOutbound: true,
      callerName: true,
      callerNameStatus: true,
      isCallerNameRequested: true,
      callerNameRequestId: true,
    },
  })

  if (!row || row.callerNameStatus !== 'pending' || !row.isCallerNameRequested) return

  if (
    row.status !== 'active' ||
    !row.assignedUserId ||
    !row.isActiveForOutbound ||
    !row.twilioSid ||
    !row.callerName
  ) {
    await prisma.phoneNumber.updateMany({
      where: pendingRequestWhere(row),
      data: { callerNameStatus: 'failed', callerNameFailureReason: ACTIVE_NUMBER_ERROR },
    })
    return
  }

  try {
    const result = row.callerNameRequestId
      ? await reconcileCallerNameRegistration({ requestId: row.callerNameRequestId })
      : await submitCallerNameRegistration({
          e164: row.e164,
          phoneNumberSid: row.twilioSid,
          callerName: row.callerName,
        })

    await recordOutcome(row, result)
    if (result.kind === 'pending') {
      await sendJobAfter(
        JOB_RECONCILE_CALLER_NAME,
        { phoneNumberId: row.id },
        { retryLimit: CALLER_NAME_RETRY_LIMIT, retryDelay: CALLER_NAME_RETRY_DELAY_SECONDS },
        CALLER_NAME_RECONCILIATION_DELAY_SECONDS,
      )
    }
    logger.info({ orgId: row.orgId, phoneNumberId: row.id, callerNameStatus: result.kind }, 'reconciled caller-ID name')
  } catch (error) {
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { orgId: row.orgId, phoneNumberId: row.id, retryCount: attempt.retryCount, error },
        'caller-ID name provider failed; retrying',
      )
      throw error
    }

    await prisma.phoneNumber.updateMany({
      where: pendingRequestWhere(row),
      data: { callerNameStatus: 'failed', callerNameFailureReason: PROVIDER_ERROR },
    })
    logger.error({ orgId: row.orgId, phoneNumberId: row.id, error }, 'caller-ID name provider failed')
  }
}

/** Queue a reconciliation after a caller saves an enabled, valid name. */
export async function queueCallerNameReconciliation(phoneNumberId: string): Promise<string | null> {
  return sendJob(JOB_RECONCILE_CALLER_NAME, { phoneNumberId }, {
    retryLimit: CALLER_NAME_RETRY_LIMIT,
    retryDelay: CALLER_NAME_RETRY_DELAY_SECONDS,
  })
}

/** Attach the worker once at server startup, never from app.ts or route tests. */
export async function registerCallerNameReconciliationWorker(): Promise<string> {
  return workJob<ReconcileCallerNamePayload>(JOB_RECONCILE_CALLER_NAME, { batchSize: 1 }, async (job) => {
    await reconcileCallerNameJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
