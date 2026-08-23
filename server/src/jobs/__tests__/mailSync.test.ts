import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  mailAccount: { findFirst: vi.fn(), updateMany: vi.fn() },
  membership: { findFirst: vi.fn() },
  email: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  emailParticipant: { deleteMany: vi.fn(), createMany: vi.fn() },
  meeting: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  meetingAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: db }))

const provider = vi.hoisted(() => ({
  getMailProvider: vi.fn(),
}))
vi.mock('../../lib/mail/getMailProvider.js', () => provider)

const matcher = vi.hoisted(() => ({
  resolveParticipantsToCrm: vi.fn(),
  attachEmailMatchInTx: vi.fn(),
  attachMeetingMatchInTx: vi.fn(),
}))
vi.mock('../../lib/crmMatch.js', () => matcher)

const queue = vi.hoisted(() => ({ scheduleJob: vi.fn(), sendJob: vi.fn(), workJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_MAIL_SYNC: 'mail-sync',
  scheduleJob: queue.scheduleJob,
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import { CursorExpiredError, RateLimitedError } from '../../lib/mail/mailErrors.js'
import {
  MAIL_SYNC_CRON,
  registerMailSyncWorker,
  scheduleMailSync,
  syncMailAccount,
} from '../mailSync.js'

const ACCOUNT = {
  id: 'mail_1',
  orgId: 'org_1',
  userId: 'user_1',
  provider: 'google',
  emailAddress: 'seller@example.test',
  mailSyncCursor: 'history-old',
  calendarSyncCursor: 'calendar-old',
  user: { enabled: true },
}

const PAGE_PROVIDER = {
  provider: 'google' as const,
  listMessagesSince: vi.fn(),
  listEventsSince: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  db.mailAccount.findFirst.mockResolvedValue(ACCOUNT)
  db.membership.findFirst.mockResolvedValue({ id: 'membership_1' })
  db.$transaction.mockImplementation(async (callback) => callback(db))
  db.email.findFirst.mockResolvedValue(null)
  db.email.create.mockResolvedValue({
    id: 'email_1', orgId: ACCOUNT.orgId, manualAttach: false, sentAt: new Date('2026-08-23T12:00:00.000Z'), receivedAt: null, createdAt: new Date('2026-08-23T12:00:00.000Z'),
  })
  db.email.findFirstOrThrow.mockResolvedValue({
    id: 'email_1', orgId: ACCOUNT.orgId, manualAttach: false, sentAt: new Date('2026-08-23T12:00:00.000Z'), receivedAt: null, createdAt: new Date('2026-08-23T12:00:00.000Z'),
  })
  db.meeting.findFirst.mockResolvedValue(null)
  db.meeting.create.mockResolvedValue({
    id: 'meeting_1', orgId: ACCOUNT.orgId, manualAttach: false, startsAt: new Date('2026-08-23T12:00:00.000Z'), organizerEmail: null,
  })
  db.meeting.findFirstOrThrow.mockResolvedValue({
    id: 'meeting_1', orgId: ACCOUNT.orgId, manualAttach: false, startsAt: new Date('2026-08-23T12:00:00.000Z'), organizerEmail: null,
  })
  matcher.resolveParticipantsToCrm.mockResolvedValue({ excluded: false, personIds: [], companyIds: [], personIdByAddress: {}, primaryPersonId: null, primaryCompanyId: null, dealId: null })
  matcher.attachEmailMatchInTx.mockResolvedValue(false)
  matcher.attachMeetingMatchInTx.mockResolvedValue(false)
  PAGE_PROVIDER.listMessagesSince.mockResolvedValue({ messages: [], nextCursor: 'history-new' })
  PAGE_PROVIDER.listEventsSince.mockResolvedValue({ events: [], nextCursor: 'calendar-new' })
  provider.getMailProvider.mockResolvedValue(PAGE_PROVIDER)
})

describe('syncMailAccount', () => {
  it('does nothing for a suspended user, keeping existing activity and cursors intact', async () => {
    db.mailAccount.findFirst.mockResolvedValue({ ...ACCOUNT, user: { enabled: false } })

    await expect(syncMailAccount(ACCOUNT.id)).resolves.toEqual({ skipped: true, emails: 0, meetings: 0, recovered: false })

    expect(provider.getMailProvider).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('restarts both stale provider cursors from a bounded fresh page and checkpoints the replacement cursors', async () => {
    PAGE_PROVIDER.listMessagesSince
      .mockRejectedValueOnce(new CursorExpiredError())
      .mockResolvedValueOnce({ messages: [], nextCursor: 'history-fresh' })
    PAGE_PROVIDER.listEventsSince
      .mockRejectedValueOnce(new CursorExpiredError())
      .mockResolvedValueOnce({ events: [], nextCursor: 'calendar-fresh' })

    await expect(syncMailAccount(ACCOUNT.id)).resolves.toEqual({ skipped: false, emails: 0, meetings: 0, recovered: true })

    expect(PAGE_PROVIDER.listMessagesSince.mock.calls.map(([cursor]) => cursor)).toEqual(['history-old', null])
    expect(PAGE_PROVIDER.listEventsSince.mock.calls.map(([cursor]) => cursor)).toEqual(['calendar-old', null])
    expect(db.mailAccount.updateMany).toHaveBeenCalledWith({
      where: { id: ACCOUNT.id, orgId: ACCOUNT.orgId, userId: ACCOUNT.userId },
      data: expect.objectContaining({ mailSyncCursor: 'history-fresh', calendarSyncCursor: 'calendar-fresh' }),
    })
  })

  it('persists incoming mail and meetings before sending their participants through the shared matcher', async () => {
    PAGE_PROVIDER.listMessagesSince.mockResolvedValue({
      messages: [{
        providerMsgId: 'message_1', threadId: 'thread_1', from: { email: 'seller@example.test' }, to: [{ email: 'buyer@customer.test' }], cc: [],
        subject: 'Proposal', bodyHtml: '<p>Hello</p>', bodyText: 'Hello', sentAt: new Date('2026-08-23T12:00:00.000Z'), isOutbound: false,
      }],
      nextCursor: 'history-new',
    })
    PAGE_PROVIDER.listEventsSince.mockResolvedValue({
      events: [{
        providerEventId: 'event_1', title: 'Discovery', description: null, startsAt: new Date('2026-08-24T12:00:00.000Z'), endsAt: new Date('2026-08-24T12:30:00.000Z'),
        isAllDay: false, attendees: [{ email: 'buyer@customer.test' }], organizer: { email: 'seller@example.test' },
      }],
      nextCursor: 'calendar-new',
    })

    await expect(syncMailAccount(ACCOUNT.id)).resolves.toEqual({ skipped: false, emails: 1, meetings: 1, recovered: false })

    expect(db.email.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      mailAccountId: ACCOUNT.id, providerMessageId: 'message_1', direction: 'inbound',
    }) }))
    expect(db.meeting.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      provider: 'gmail', providerEventId: 'event_1', title: 'Discovery',
    }) }))
    expect(matcher.resolveParticipantsToCrm).toHaveBeenCalledTimes(2)
    expect(matcher.attachEmailMatchInTx).toHaveBeenCalledTimes(1)
    expect(matcher.attachMeetingMatchInTx).toHaveBeenCalledTimes(1)
  })

  it('updates a replayed provider message instead of creating a duplicate', async () => {
    db.email.findFirst.mockResolvedValue({ id: 'email_existing' })
    PAGE_PROVIDER.listMessagesSince.mockResolvedValue({
      messages: [{
        providerMsgId: 'message_1', threadId: null, from: { email: 'seller@example.test' }, to: [], cc: [],
        subject: 'Updated subject', bodyHtml: null, bodyText: null, sentAt: new Date('2026-08-23T12:00:00.000Z'), isOutbound: true,
      }],
      nextCursor: 'history-new',
    })

    await syncMailAccount(ACCOUNT.id)

    expect(db.email.create).not.toHaveBeenCalled()
    expect(db.email.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'email_existing', orgId: ACCOUNT.orgId },
      data: expect.objectContaining({ providerMessageId: 'message_1', subject: 'Updated subject' }),
    }))
  })
})

describe('mail-sync pg-boss wiring', () => {
  it('schedules a five-minute dispatcher and processes one queued account at a time', async () => {
    await scheduleMailSync()
    expect(queue.scheduleJob).toHaveBeenCalledWith('mail-sync', MAIL_SYNC_CRON)

    queue.workJob.mockResolvedValue('worker_1')
    await registerMailSyncWorker()
    expect(queue.workJob).toHaveBeenCalledWith('mail-sync', { batchSize: 1 }, expect.any(Function))
  })

  it('honors a provider Retry-After by rescheduling only that mailbox', async () => {
    queue.workJob.mockResolvedValue('worker_1')
    PAGE_PROVIDER.listMessagesSince.mockRejectedValue(new RateLimitedError(90_000))
    await registerMailSyncWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!

    await expect(handler({ data: { mailAccountId: ACCOUNT.id }, retryCount: 0, retryLimit: 3 })).resolves.toBeUndefined()

    expect(queue.sendJob).toHaveBeenCalledWith(
      'mail-sync',
      { mailAccountId: ACCOUNT.id, rateLimitRetries: 1 },
      expect.objectContaining({ singletonKey: ACCOUNT.id, retryLimit: 3, startAfter: expect.any(Date) }),
    )
    const startAfter = queue.sendJob.mock.calls[0]![2].startAfter as Date
    expect(startAfter.getTime()).toBeGreaterThanOrEqual(Date.now() + 89_000)
  })
})
