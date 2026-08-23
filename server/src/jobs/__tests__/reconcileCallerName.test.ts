// Unit tests for the carrier caller-name registration job.
//
// The carrier boundary is a fake in this suite. No test can submit or reconcile
// a real CNAM registration because that can change a real number's caller ID.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { phoneNumber: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const carrier = vi.hoisted(() => ({
  submitCallerNameRegistration: vi.fn(),
  reconcileCallerNameRegistration: vi.fn(),
}))

vi.mock('../../../dependencies/callerNameRegistration.js', () => carrier)

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), sendJobAfter: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_RECONCILE_CALLER_NAME: 'reconcile-caller-name',
  sendJob: queue.sendJob,
  sendJobAfter: queue.sendJobAfter,
  workJob: queue.workJob,
}))

import {
  queueCallerNameReconciliation,
  reconcileCallerNameJob,
  registerCallerNameReconciliationWorker,
} from '../reconcileCallerName.js'

const ROW = {
  id: 'pn_1',
  orgId: 'org_1',
  assignedUserId: 'user_1',
  e164: '+12025550123',
  twilioSid: 'PN123',
  status: 'active',
  isActiveForOutbound: true,
  callerName: 'Acme Sales',
  callerNameStatus: 'pending',
  isCallerNameRequested: true,
  callerNameRequestId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  queue.sendJob.mockResolvedValue('job-1')
  queue.sendJobAfter.mockResolvedValue('job-2')
  queue.workJob.mockResolvedValue('worker-1')
})

describe('reconcileCallerNameJob', () => {
  it('submits only an enabled, active primary number and records the carrier request id', async () => {
    carrier.submitCallerNameRegistration.mockResolvedValue({ kind: 'pending', requestId: 'CNAM-1' })

    await reconcileCallerNameJob({ phoneNumberId: ROW.id })

    expect(carrier.submitCallerNameRegistration).toHaveBeenCalledWith({
      e164: ROW.e164,
      phoneNumberSid: ROW.twilioSid,
      callerName: ROW.callerName,
    })
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        id: ROW.id,
        orgId: ROW.orgId,
        callerNameStatus: 'pending',
        isCallerNameRequested: true,
        callerName: ROW.callerName,
        callerNameRequestId: null,
      },
      data: { callerNameStatus: 'pending', callerNameRequestId: 'CNAM-1', callerNameFailureReason: null },
    })
    expect(queue.sendJobAfter).toHaveBeenCalledWith(
      'reconcile-caller-name',
      { phoneNumberId: ROW.id },
      { retryLimit: 2, retryDelay: 60 },
      300,
    )
  })

  it('reconciles a recorded carrier request to active without changing the outbound number', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, callerNameRequestId: 'CNAM-1' })
    carrier.reconcileCallerNameRegistration.mockResolvedValue({ kind: 'active' })

    await reconcileCallerNameJob({ phoneNumberId: ROW.id })

    expect(carrier.reconcileCallerNameRegistration).toHaveBeenCalledWith({ requestId: 'CNAM-1' })
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { callerNameStatus: 'active', callerNameFailureReason: null },
      }),
    )
    expect(db.updateMany.mock.calls[0]![0].data).not.toHaveProperty('isActiveForOutbound')
  })

  it.each([
    [{ kind: 'failed', reason: 'The carrier rejected this caller-ID name.' }, 'failed'],
    [{ kind: 'unsupported', reason: 'This carrier does not support caller-ID name registration.' }, 'unsupported'],
  ] as const)('records a truthful %s outcome from the carrier', async (result, status) => {
    carrier.submitCallerNameRegistration.mockResolvedValue(result)

    await reconcileCallerNameJob({ phoneNumberId: ROW.id })

    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { callerNameStatus: status, callerNameFailureReason: result.reason },
      }),
    )
  })

  it('does not submit a stale request after the number stops being the active owned outbound number', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, isActiveForOutbound: false })

    await reconcileCallerNameJob({ phoneNumberId: ROW.id })

    expect(carrier.submitCallerNameRegistration).not.toHaveBeenCalled()
    expect(carrier.reconcileCallerNameRegistration).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          callerNameStatus: 'failed',
          callerNameFailureReason: 'Make this number your active outbound number, then save the caller-ID name again.',
        },
      }),
    )
  })

  it('does nothing when an earlier run already settled the request', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, callerNameStatus: 'active' })

    await reconcileCallerNameJob({ phoneNumberId: ROW.id })

    expect(carrier.submitCallerNameRegistration).not.toHaveBeenCalled()
    expect(carrier.reconcileCallerNameRegistration).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('queueCallerNameReconciliation', () => {
  it('queues a retry-safe reconciliation job', async () => {
    await queueCallerNameReconciliation(ROW.id)

    expect(queue.sendJob).toHaveBeenCalledWith(
      'reconcile-caller-name',
      { phoneNumberId: ROW.id },
      { retryLimit: 2, retryDelay: 60 },
    )
  })
})

describe('registerCallerNameReconciliationWorker', () => {
  it('works one registration at a time', async () => {
    await registerCallerNameReconciliationWorker()

    const [name, options] = queue.workJob.mock.calls[0]!
    expect(name).toBe('reconcile-caller-name')
    expect(options).toEqual({ batchSize: 1 })
  })
})
