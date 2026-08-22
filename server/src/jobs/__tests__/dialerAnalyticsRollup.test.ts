import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  orgFindMany: vi.fn(),
  queryRaw: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: {
    org: { findMany: db.orgFindMany },
    analyticsRollup: { deleteMany: db.deleteMany, createMany: db.createMany },
    $queryRaw: db.queryRaw,
    $transaction: db.transaction,
  },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), scheduleJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_DIALER_ANALYTICS_ROLLUP: 'dialer-analytics-rollup',
  sendJob: queue.sendJob,
  scheduleJob: queue.scheduleJob,
  workJob: queue.workJob,
}))

import {
  DIALER_ANALYTICS_ROLLUP_CRON,
  queueDialerAnalyticsRollup,
  registerDialerAnalyticsRollupWorker,
  rollupDialerAnalyticsForOrg,
  scheduleDialerAnalyticsRollup,
} from '../dialerAnalyticsRollup.js'

const ORG_ID = 'org-a'

beforeEach(() => {
  vi.clearAllMocks()
  db.orgFindMany.mockResolvedValue([])
  db.queryRaw.mockResolvedValue([])
  db.deleteMany.mockResolvedValue({ count: 0 })
  db.createMany.mockResolvedValue({ count: 0 })
  db.transaction.mockImplementation(async (callback) => callback({
    analyticsRollup: { deleteMany: db.deleteMany, createMany: db.createMany },
  }))
})

describe('rollupDialerAnalyticsForOrg', () => {
  it('replaces one org’s daily rows with its hand-counted outbound number and prospect-area totals', async () => {
    db.queryRaw.mockResolvedValue([
      { day: new Date('2026-08-21T00:00:00.000Z'), numberE164: '+14155550110', areaCode: '212', dials: 2n, connects: 1n },
      { day: new Date('2026-08-22T00:00:00.000Z'), numberE164: '+12125550120', areaCode: '415', dials: 1n, connects: 1n },
      { day: new Date('2026-08-21T00:00:00.000Z'), numberE164: '+14155550110', areaCode: null, dials: 1n, connects: 1n },
    ])

    const result = await rollupDialerAnalyticsForOrg(ORG_ID)

    expect(db.queryRaw).toHaveBeenCalledTimes(1)
    expect(db.queryRaw.mock.calls[0][0].values).toEqual([ORG_ID])
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { orgId: ORG_ID } })
    expect(db.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { orgId: ORG_ID, day: new Date('2026-08-21T00:00:00.000Z'), hourOfDay: null, numberE164: '+14155550110', areaCode: '212', dials: 2, connects: 1 },
        { orgId: ORG_ID, day: new Date('2026-08-22T00:00:00.000Z'), hourOfDay: null, numberE164: '+12125550120', areaCode: '415', dials: 1, connects: 1 },
        { orgId: ORG_ID, day: new Date('2026-08-21T00:00:00.000Z'), hourOfDay: null, numberE164: '+14155550110', areaCode: null, dials: 1, connects: 1 },
      ]),
    })
    expect(result).toEqual({ dials: 4, connects: 3, rows: 3 })
  })

  it('does not mix another organization’s call rows into this rollup', async () => {
    await rollupDialerAnalyticsForOrg(ORG_ID)

    expect(db.queryRaw.mock.calls[0][0].values).toEqual([ORG_ID])
  })
})

describe('dialer analytics queue wiring', () => {
  it('enqueues one coalesced job per organization', async () => {
    queue.sendJob.mockResolvedValue('job-1')

    await queueDialerAnalyticsRollup(ORG_ID)

    expect(queue.sendJob).toHaveBeenCalledWith(
      'dialer-analytics-rollup',
      { orgId: ORG_ID },
      expect.objectContaining({ singletonKey: ORG_ID }),
    )
  })

  it('schedules the hourly dispatcher and gives it no tenant payload', async () => {
    await scheduleDialerAnalyticsRollup()

    expect(queue.scheduleJob).toHaveBeenCalledWith('dialer-analytics-rollup', DIALER_ANALYTICS_ROLLUP_CRON)
  })

  it('fans the hourly dispatcher out into one coalesced job per organization', async () => {
    db.orgFindMany.mockResolvedValue([{ id: 'org-a' }, { id: 'org-b' }])
    queue.workJob.mockResolvedValue('worker-1')

    await registerDialerAnalyticsRollupWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!
    await handler({ data: {} })

    expect(queue.sendJob).toHaveBeenCalledWith('dialer-analytics-rollup', { orgId: 'org-a' }, expect.objectContaining({ singletonKey: 'org-a' }))
    expect(queue.sendJob).toHaveBeenCalledWith('dialer-analytics-rollup', { orgId: 'org-b' }, expect.objectContaining({ singletonKey: 'org-b' }))
  })
})
