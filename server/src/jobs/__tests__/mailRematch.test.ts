import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  person: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  unmatchedActivity: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  email: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: db }))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_MAIL_REMATCH: 'mail-rematch',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

const matcher = vi.hoisted(() => ({
  resolveParticipantsToCrm: vi.fn(),
  attachEmailMatchInTx: vi.fn(),
  normalizeParticipantAddress: (value: string) => value.trim().toLowerCase(),
  candidateCompanyDomains: (address: string) => {
    const labels = address.trim().toLowerCase().split('@')[1]?.split('.') ?? []
    return labels.length >= 2 ? [labels.slice(-2).join('.')] : []
  },
}))
vi.mock('../../lib/crmMatch.js', () => matcher)

import {
  holdUnmatchedEmailInTx,
  queueMailRematch,
  registerMailRematchWorker,
  rematchMailActivityJob,
} from '../mailRematch.js'

const NOW = new Date('2026-08-23T12:00:00.000Z')
const HOLD = {
  orgId: 'org-1',
  sourceKey: 'mailbox-1:<thread-1@example.test>',
  occurredAt: new Date('2026-08-22T12:00:00.000Z'),
  email: {
    mailAccountId: 'mailbox-1',
    direction: 'inbound' as const,
    subject: 'A past thread',
    internetMessageId: '<thread-1@example.test>',
    receivedAt: new Date('2026-08-22T12:00:00.000Z'),
  },
  participants: [{ role: 'from', address: 'jane@acme.com' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db))
  db.person.findFirst.mockResolvedValue({ id: 'person-1', orgId: 'org-1', addresses: [{ address: 'jane@acme.com' }] })
  db.unmatchedActivity.findMany.mockResolvedValue([{ id: 'hold-1', ...HOLD, payload: HOLD }])
  db.email.findMany.mockResolvedValue([])
  db.email.findFirst.mockResolvedValue(null)
  db.email.create.mockResolvedValue({
    id: 'email-1', orgId: 'org-1', manualAttach: false, companyId: null, dealId: null,
    direction: 'inbound', subject: 'A past thread', snippet: null, bodyText: null,
    sentAt: null, receivedAt: HOLD.occurredAt, createdAt: HOLD.occurredAt,
  })
  db.unmatchedActivity.upsert.mockResolvedValue({ id: 'hold-1' })
  db.unmatchedActivity.deleteMany.mockResolvedValue({ count: 1 })
  matcher.resolveParticipantsToCrm.mockResolvedValue({
    excluded: false, exclusion: null, primaryPersonId: 'person-1', primaryCompanyId: null,
    personIds: ['person-1'], personIdByAddress: { 'jane@acme.com': 'person-1' }, companyIds: [], dealId: null,
  })
  matcher.attachEmailMatchInTx.mockResolvedValue(true)
})

describe('unmatched email hold', () => {
  it('parks a zero-match email outside CRM storage with rematch metadata', async () => {
    await holdUnmatchedEmailInTx(db as never, HOLD)

    expect(db.unmatchedActivity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId_sourceType_sourceKey: { orgId: 'org-1', sourceType: 'email', sourceKey: HOLD.sourceKey } },
      create: expect.objectContaining({
        orgId: 'org-1', sourceType: 'email', sourceKey: HOLD.sourceKey,
        participantAddresses: ['jane@acme.com'], participantDomainCandidates: ['acme.com'],
      }),
    }))
    expect(db.email.create).not.toHaveBeenCalled()
  })
})

describe('rematchMailActivityJob', () => {
  it('rehydrates a held email, attaches it after a Person is created, then clears the hold', async () => {
    const result = await rematchMailActivityJob({ orgId: 'org-1', recordType: 'person', recordId: 'person-1' }, NOW)

    expect(result).toEqual({ heldScanned: 1, heldAttached: 1, recentScanned: 0, recentAttached: 0 })
    expect(db.email.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: 'org-1', internetMessageId: '<thread-1@example.test>' }),
    }))
    expect(matcher.attachEmailMatchInTx).toHaveBeenCalledWith(db, expect.objectContaining({ id: 'email-1' }), expect.any(Object))
    expect(db.unmatchedActivity.deleteMany).toHaveBeenCalledWith({ where: { id: 'hold-1', orgId: 'org-1' } })
  })
})

describe('mail-rematch queue wiring', () => {
  it('uses the created CRM record as the singleton key and retries up to three times', async () => {
    await queueMailRematch({ orgId: 'org-1', recordType: 'person', recordId: 'person-1' })

    expect(queue.sendJob).toHaveBeenCalledWith(
      'mail-rematch',
      { orgId: 'org-1', recordType: 'person', recordId: 'person-1' },
      { retryLimit: 3, singletonKey: 'person-1' },
    )
  })

  it('registers a one-at-a-time worker', async () => {
    queue.workJob.mockResolvedValue('worker-1')

    await registerMailRematchWorker()

    expect(queue.workJob).toHaveBeenCalledWith('mail-rematch', { batchSize: 1 }, expect.any(Function))
  })
})
