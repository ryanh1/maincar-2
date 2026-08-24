// Unit tests for the stale-call reaper.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma
// never connects (../../db.js), and Twilio is never called
// (dependencies/twilio.js). The job's whole value is its selection query and its
// reconcile-vs-backstop decision, and that is exactly what these exercise
// without standing up a queue, a database, or a Twilio account.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { call: { findMany: db.findMany, updateMany: db.updateMany } },
}))

const twilio = vi.hoisted(() => ({ fetchCallStatus: vi.fn() }))

vi.mock('../../../dependencies/twilio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/twilio.js')>()
  return {
    // twilioErrorStatus is pure translation with no SDK call in it, so the real
    // one is used, exactly as uploadRecording.test.ts does.
    ...actual,
    fetchCallStatus: twilio.fetchCallStatus,
  }
})

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ scheduleJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_REAP_STALE_CALLS: 'reap-stale-calls',
  scheduleJob: queue.scheduleJob,
  workJob: queue.workJob,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  DIALED_STALE_MS,
  reapStaleCallsJob,
  REAP_STALE_CALLS_CRON,
  registerReapStaleCallsWorker,
  scheduleReapStaleCalls,
} from '../reapStaleCalls.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')

/** A stale row, aged just past the threshold unless overridden. */
function staleRow(overrides: {
  id?: string
  orgId?: string
  userId?: string
  status?: string
  twilioCallSid?: string | null
  updatedAt?: Date
} = {}) {
  return {
    id: 'call_1',
    orgId: 'org_1',
    userId: 'user_1',
    status: 'ringing',
    twilioCallSid: 'CA0123456789abcdef',
    updatedAt: new Date(NOW.getTime() - DIALED_STALE_MS - 1_000),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findMany.mockResolvedValue([])
  db.updateMany.mockResolvedValue({ count: 1 })
})

describe('reapStaleCallsJob — selection', () => {
  it('queries for in-flight calls older than the staleness threshold', async () => {
    await reapStaleCallsJob(NOW)

    expect(db.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['queued', 'ringing', 'in-progress'] },
        updatedAt: { lt: new Date(NOW.getTime() - DIALED_STALE_MS) },
      },
      select: { id: true, orgId: true, userId: true, status: true, twilioCallSid: true, updatedAt: true },
    })
  })

  it('reports nothing scanned or settled when nothing is stale', async () => {
    const result = await reapStaleCallsJob(NOW)

    expect(result).toEqual({ scanned: 0, settled: 0 })
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('reapStaleCallsJob — no Twilio SID to reconcile against', () => {
  it('settles to the backstop status without calling Twilio', async () => {
    const row = staleRow({ twilioCallSid: null })
    db.findMany.mockResolvedValue([row])

    const result = await reapStaleCallsJob(NOW)

    expect(twilio.fetchCallStatus).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, orgId: row.orgId, status: { in: ['queued', 'ringing', 'in-progress'] } },
      data: { status: 'failed', endedAt: NOW },
    })
    expect(result).toEqual({ scanned: 1, settled: 1 })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dialer_call_state_changed',
        callId: row.id,
        orgId: row.orgId,
        userId: row.userId,
        oldStatus: 'ringing',
        newStatus: 'failed',
        reconciledFromTwilio: false,
      }),
      expect.stringContaining('settled a call stuck past the staleness threshold'),
    )
  })
})

describe('reapStaleCallsJob — reconciling against Twilio', () => {
  it('settles to Twilio’s terminal status and carries its duration over', async () => {
    const row = staleRow()
    db.findMany.mockResolvedValue([row])
    twilio.fetchCallStatus.mockResolvedValue({ sid: row.twilioCallSid, status: 'completed', durationS: 42 })

    const result = await reapStaleCallsJob(NOW)

    expect(twilio.fetchCallStatus).toHaveBeenCalledWith(row.twilioCallSid)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, orgId: row.orgId, status: { in: ['queued', 'ringing', 'in-progress'] } },
      data: { status: 'completed', endedAt: NOW, durationS: 42 },
    })
    expect(result).toEqual({ scanned: 1, settled: 1 })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dialer_call_state_changed',
        userId: row.userId,
        oldStatus: 'ringing',
        newStatus: 'completed',
        reconciledFromTwilio: true,
      }),
      expect.any(String),
    )
  })

  it('leaves a call alone, unsettled, when Twilio still reports it in flight', async () => {
    const row = staleRow()
    db.findMany.mockResolvedValue([row])
    twilio.fetchCallStatus.mockResolvedValue({ sid: row.twilioCallSid, status: 'in-progress', durationS: null })

    const result = await reapStaleCallsJob(NOW)

    expect(db.updateMany).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 1, settled: 0 })
  })

  it('falls back to the backstop status when the Twilio fetch itself fails', async () => {
    const row = staleRow()
    db.findMany.mockResolvedValue([row])
    twilio.fetchCallStatus.mockRejectedValue(Object.assign(new Error('twilio down'), { status: 500 }))

    const result = await reapStaleCallsJob(NOW)

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, orgId: row.orgId, status: { in: ['queued', 'ringing', 'in-progress'] } },
      data: { status: 'failed', endedAt: NOW },
    })
    expect(result).toEqual({ scanned: 1, settled: 1 })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ callId: row.id, twilioStatus: 500 }),
      expect.stringContaining('could not reconcile against Twilio'),
    )
  })
})

describe('reapStaleCallsJob — losing a race to a real webhook', () => {
  it('does not count a row as settled when the compare-and-set writes nothing', async () => {
    const row = staleRow({ twilioCallSid: null })
    db.findMany.mockResolvedValue([row])
    db.updateMany.mockResolvedValue({ count: 0 })

    const result = await reapStaleCallsJob(NOW)

    expect(result).toEqual({ scanned: 1, settled: 0 })
  })
})

describe('reapStaleCallsJob — multiple rows', () => {
  it('settles each stale call independently and totals both counters', async () => {
    const stuck = staleRow({ id: 'call_1', twilioCallSid: null })
    const stillGoing = staleRow({ id: 'call_2', twilioCallSid: 'CA_2' })
    db.findMany.mockResolvedValue([stuck, stillGoing])
    twilio.fetchCallStatus.mockResolvedValue({ sid: 'CA_2', status: 'ringing', durationS: null })

    const result = await reapStaleCallsJob(NOW)

    expect(result).toEqual({ scanned: 2, settled: 1 })
    expect(db.updateMany).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// registerReapStaleCallsWorker / scheduleReapStaleCalls — pg-boss wiring
// ============================================================
describe('registerReapStaleCallsWorker', () => {
  it('subscribes to the reap-stale-calls queue one job at a time', async () => {
    queue.workJob.mockResolvedValue('worker_1')

    await registerReapStaleCallsWorker()

    expect(queue.workJob).toHaveBeenCalledTimes(1)
    const [name, options] = queue.workJob.mock.calls[0]!
    expect(name).toBe('reap-stale-calls')
    expect(options).toEqual({ batchSize: 1 })
  })

  it('runs the sweep when pg-boss invokes the handler', async () => {
    queue.workJob.mockResolvedValue('worker_1')
    await registerReapStaleCallsWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!

    await handler({ data: {} })

    expect(db.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('scheduleReapStaleCalls', () => {
  it('puts the sweep on its recurring cron schedule', async () => {
    await scheduleReapStaleCalls()

    expect(queue.scheduleJob).toHaveBeenCalledWith('reap-stale-calls', REAP_STALE_CALLS_CRON)
  })
})
