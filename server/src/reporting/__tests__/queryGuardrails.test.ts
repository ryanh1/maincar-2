import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_REPORT_MAX_GROUPS,
  ReportGroupLimitError,
  ReportQueryTimeoutError,
  executeGuardedReportQuery,
} from '../queryGuardrails.js'

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: database }))

describe('executeGuardedReportQuery', () => {
  it('sets a transaction-local statement timeout before estimating and executing the report', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const estimateGroups = vi.fn().mockResolvedValue(2)
    const execute = vi.fn().mockResolvedValue({ rows: ['won', 'lost'] })
    database.$transaction.mockImplementationOnce((callback) => callback(tx))

    await expect(
      executeGuardedReportQuery({
        estimateGroups,
        execute,
        timeoutMs: 250,
      }),
    ).resolves.toEqual({ rows: ['won', 'lost'] })

    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(estimateGroups).toHaveBeenCalledWith(tx)
    expect(execute).toHaveBeenCalledWith(tx)
    expect(estimateGroups.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$executeRaw.mock.invocationCallOrder[0],
    )
    expect(execute.mock.invocationCallOrder[0]).toBeGreaterThan(
      estimateGroups.mock.invocationCallOrder[0],
    )
  })

  it('caps an over-limit pivot before its query is executed', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const execute = vi.fn()
    database.$transaction.mockImplementationOnce((callback) => callback(tx))

    await expect(
      executeGuardedReportQuery({
        estimateGroups: vi.fn().mockResolvedValue(DEFAULT_REPORT_MAX_GROUPS + 1),
        execute,
      }),
    ).rejects.toEqual(
      new ReportGroupLimitError(DEFAULT_REPORT_MAX_GROUPS + 1, DEFAULT_REPORT_MAX_GROUPS),
    )

    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an invalid group estimate before its query is executed', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const execute = vi.fn()
    database.$transaction.mockImplementationOnce((callback) => callback(tx))

    await expect(
      executeGuardedReportQuery({
        estimateGroups: vi.fn().mockResolvedValue(Number.NaN),
        execute,
      }),
    ).rejects.toThrow('estimateGroups must resolve to a non-negative integer')

    expect(execute).not.toHaveBeenCalled()
  })

  it('returns a friendly timeout error when PostgreSQL cancels a report query', async () => {
    const tx = {
      $executeRaw: vi.fn().mockRejectedValue({ code: '57014' }),
    }
    database.$transaction.mockImplementationOnce((callback) => callback(tx))

    await expect(
      executeGuardedReportQuery({
        estimateGroups: vi.fn(),
        execute: vi.fn(),
      }),
    ).rejects.toEqual(new ReportQueryTimeoutError())
  })
})
