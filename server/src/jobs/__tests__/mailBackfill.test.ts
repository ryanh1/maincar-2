import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  backfillUpsert: vi.fn(),
  backfillUpdateMany: vi.fn(),
  emailFindFirst: vi.fn(),
  emailCreate: vi.fn(),
  transaction: vi.fn(),
}))

const provider = vi.hoisted(() => ({ listBackfillMessages: vi.fn() }))
const matcher = vi.hoisted(() => ({ resolveParticipantsToCrm: vi.fn(), attachEmailMatchInTx: vi.fn() }))
const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../../db.js', () => ({
  default: {
    mailAccount: { findUnique: db.accountFindUnique },
    mailBackfill: { upsert: db.backfillUpsert, updateMany: db.backfillUpdateMany },
    $transaction: db.transaction,
  },
}))
vi.mock('../../lib/mail/getMailProvider.js', () => ({ getMailProvider: vi.fn(() => provider) }))
vi.mock('../../lib/crmMatch.js', () => matcher)
vi.mock('../queue.js', () => ({ JOB_MAIL_BACKFILL: 'mail-backfill', sendJob: queue.sendJob, workJob: queue.workJob }))

import { mailBackfillJob, queueMailBackfill, registerMailBackfillWorker } from '../mailBackfill.js'

const message = {
  providerMsgId: 'google-1', threadId: 'thread-1', from: { email: 'rep@maincar.com' },
  to: [{ email: 'jane@acme.com' }], cc: [], subject: 'Hello', bodyHtml: '<p>Hello</p>',
  bodyText: 'Hello', sentAt: new Date('2026-08-20T12:00:00.000Z'), isOutbound: false,
}
const match = {
  excluded: false, exclusion: null, primaryPersonId: 'person-1', primaryCompanyId: 'company-1',
  personIds: ['person-1'], personIdByAddress: { 'jane@acme.com': 'person-1' }, companyIds: ['company-1'], dealId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.accountFindUnique.mockResolvedValue({ id: 'mailbox-1', orgId: 'org-1', emailAddress: 'rep@maincar.com' })
  db.backfillUpsert.mockResolvedValue({ cursor: null })
  db.emailFindFirst.mockResolvedValue(null)
  db.emailCreate.mockResolvedValue({ id: 'email-1', orgId: 'org-1', manualAttach: false, ...message })
  db.backfillUpdateMany.mockResolvedValue({ count: 1 })
  db.transaction.mockImplementation(async (callback) => callback({
    email: { findFirst: db.emailFindFirst, create: db.emailCreate },
    mailBackfill: { updateMany: db.backfillUpdateMany },
  }))
  provider.listBackfillMessages.mockResolvedValue({ messages: [message], nextCursor: 'page-2' })
  matcher.resolveParticipantsToCrm.mockResolvedValue(match)
  matcher.attachEmailMatchInTx.mockResolvedValue(true)
})

describe('mailBackfillJob', () => {
  it('pages a twelve-month provider history, persists only matched messages, and advances durable progress', async () => {
    await mailBackfillJob({ mailAccountId: 'mailbox-1' })

    expect(provider.listBackfillMessages).toHaveBeenCalledWith(null, 500, expect.any(Date))
    expect(matcher.resolveParticipantsToCrm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', participants: expect.arrayContaining([{ address: 'jane@acme.com' }]) }),
    )
    expect(db.emailCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      orgId: 'org-1', mailAccountId: 'mailbox-1', providerMessageId: 'google-1',
    }) }))
    expect(matcher.attachEmailMatchInTx).toHaveBeenCalledOnce()
    expect(db.backfillUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mailAccountId: 'mailbox-1' },
      data: expect.objectContaining({ cursor: 'page-2', scannedCount: { increment: 1 }, matchedCount: { increment: 1 } }),
    }))
  })

  it('does not persist a provider message that has no CRM match', async () => {
    matcher.resolveParticipantsToCrm.mockResolvedValue({ ...match, primaryPersonId: null, primaryCompanyId: null, personIds: [], companyIds: [] })

    await mailBackfillJob({ mailAccountId: 'mailbox-1' })

    expect(db.emailCreate).not.toHaveBeenCalled()
    expect(matcher.attachEmailMatchInTx).not.toHaveBeenCalled()
    expect(db.backfillUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scannedCount: { increment: 1 }, matchedCount: { increment: 0 } }),
    }))
  })

  it('does not duplicate a previously stored provider message', async () => {
    db.emailFindFirst.mockResolvedValue({ id: 'existing-email' })

    await mailBackfillJob({ mailAccountId: 'mailbox-1' })

    expect(db.emailCreate).not.toHaveBeenCalled()
    expect(matcher.attachEmailMatchInTx).not.toHaveBeenCalled()
  })
})

describe('mail backfill queue wiring', () => {
  it('coalesces simultaneous first-connect requests for one mailbox', async () => {
    queue.sendJob.mockResolvedValue('job-1')
    await queueMailBackfill('mailbox-1')
    expect(queue.sendJob).toHaveBeenCalledWith('mail-backfill', { mailAccountId: 'mailbox-1' }, expect.objectContaining({ singletonKey: 'mailbox-1' }))
  })

  it('registers a one-at-a-time worker', async () => {
    queue.workJob.mockResolvedValue('worker-1')
    await registerMailBackfillWorker()
    expect(queue.workJob).toHaveBeenCalledWith('mail-backfill', { batchSize: 1 }, expect.any(Function))
  })
})
