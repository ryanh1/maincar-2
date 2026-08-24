import { describe, expect, it, vi } from 'vitest'

import { getSyncHealthReport } from '../syncHealth.js'

describe('getSyncHealthReport', () => {
  it('builds per-account cursor, resync, match, subscription, hold, and queue health', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z')
    const db = {
      mailAccount: { findMany: vi.fn().mockResolvedValue([{
        id: 'mail-1',
        orgId: 'org-1',
        emailAddress: 'rep@acme.test',
        provider: 'google',
        lastSyncedAt: new Date('2026-08-23T23:00:00.000Z'),
        gmailWatchExpiresAt: new Date('2026-08-25T00:00:00.000Z'),
        org: { name: 'Acme' },
        pushSubscriptions: [{ kind: 'google_calendar', expiresAt: new Date('2026-08-24T12:00:00.000Z') }],
      }]) },
      mailSyncHealthSample: { findMany: vi.fn().mockResolvedValue([
        { mailAccountId: 'mail-1', messagesScanned: 10, messagesMatched: 8, fullResync: true },
        { mailAccountId: 'mail-1', messagesScanned: 10, messagesMatched: 2, fullResync: false },
      ]) },
      unmatchedActivity: { groupBy: vi.fn().mockResolvedValue([{ orgId: 'org-1', _count: { _all: 3 } }]) },
      org: { findMany: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Acme' }]) },
    }
    const queues = vi.fn().mockResolvedValue([{
      queue: 'mail-sync', queueDepth: 4, failureCount: 1, deadLetterCount: 2,
    }])

    const report = await getSyncHealthReport(db as never, queues, now)

    expect(report.generatedAt).toBe(now.toISOString())
    expect(report.queues[0]).toMatchObject({ queueDepth: 4, failureCount: 1, deadLetterCount: 2 })
    expect(report.accounts[0]).toMatchObject({
      cursorAgeSeconds: 3_600,
      syncRuns: 2,
      fullResyncs: 1,
      fullResyncRate: 0.5,
      messagesScanned: 20,
      messagesMatched: 10,
      matchRate: 0.5,
    })
    expect(report.subscriptions.map(({ kind, expiresInSeconds }) => ({ kind, expiresInSeconds }))).toEqual([
      { kind: 'google_calendar', expiresInSeconds: 43_200 },
      { kind: 'google_mail', expiresInSeconds: 86_400 },
    ])
    expect(report.holdBuffer).toEqual({
      total: 3,
      byOrg: [{ orgId: 'org-1', orgName: 'Acme', count: 3 }],
    })
  })
})
