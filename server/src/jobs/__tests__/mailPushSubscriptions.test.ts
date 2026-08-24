import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), scheduleJob: vi.fn(), workJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_MAIL_PUSH_SUBSCRIPTION: 'mail-push-subscription',
  JOB_MAIL_SYNC: 'mail-sync',
  scheduleJob: queue.scheduleJob,
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

const db = vi.hoisted(() => ({
  mailAccount: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  mailPushSubscription: { findUnique: vi.fn(), upsert: vi.fn() },
}))
vi.mock('../../db.js', () => ({ default: db }))

const gmail = vi.hoisted(() => ({ watchMailbox: vi.fn(), watchCalendar: vi.fn() }))
vi.mock('../../../dependencies/gmail.js', () => ({ gmailClient: vi.fn(() => gmail) }))
vi.mock('../../../dependencies/graph.js', () => ({ graphClient: vi.fn() }))
vi.mock('../../lib/mail/oauthConnections.js', () => ({ withFreshAccessToken: vi.fn().mockResolvedValue('access-token') }))
vi.mock('../../config.js', () => ({
  GOOGLE_PUBSUB_TOPIC: 'projects/maincar/topics/mail',
  PUBLIC_BASE_URL: 'https://api.maincar.test',
}))

import { queuePushMailSync, renewMailPushSubscriptions } from '../mailPushSubscriptions.js'

describe('queuePushMailSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queue.sendJob.mockResolvedValue('push-job-1')
    db.mailAccount.findFirst.mockResolvedValue({
      id: 'mailbox_1', orgId: 'org_1', provider: 'google', connectionId: 'connection_1',
    })
    db.mailAccount.updateMany.mockResolvedValue({ count: 1 })
    db.mailPushSubscription.upsert.mockResolvedValue({ id: 'subscription_1' })
    gmail.watchMailbox.mockResolvedValue({ expiration: '1787616000000' })
    gmail.watchCalendar.mockResolvedValue({
      id: 'calendar-channel', resourceId: 'calendar-resource', expiration: '1787616000000',
    })
  })

  it('immediately queues the existing keyed mail-sync job for the pushed mailbox', async () => {
    await queuePushMailSync('mailbox_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'mail-sync',
      { mailAccountId: 'mailbox_1' },
      { singletonKey: 'mailbox_1', retryLimit: 3 },
    )
  })

  it('stores the Gmail watch expiry before creating the calendar channel', async () => {
    await renewMailPushSubscriptions('mailbox_1')

    expect(db.mailAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'mailbox_1', orgId: 'org_1' },
      data: { gmailWatchExpiresAt: new Date('2026-08-25T00:00:00.000Z') },
    })
    expect(db.mailPushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kind: 'google_calendar' }),
    }))
  })
})
