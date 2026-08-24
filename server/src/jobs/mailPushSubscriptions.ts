import crypto from 'node:crypto'

import { gmailClient } from '../../dependencies/gmail.js'
import { graphClient } from '../../dependencies/graph.js'
import { GOOGLE_PUBSUB_TOPIC, PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { withFreshAccessToken } from '../lib/mail/oauthConnections.js'
import { JOB_MAIL_PUSH_SUBSCRIPTION, JOB_MAIL_SYNC, scheduleJob, sendJob, workJob } from './queue.js'

export const MAIL_PUSH_SUBSCRIPTION_CRON = '0 3 * * *'
const GRAPH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000
const GRAPH_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000

/**
 * Queue the same keyed incremental-sync job that the five-minute dispatcher uses.
 * A provider push carries no item body, so it only advances when the worker re-reads
 * the provider's durable cursor.
 */
export async function queuePushMailSync(mailAccountId: string): Promise<void> {
  await sendJob(
    JOB_MAIL_SYNC,
    { mailAccountId },
    { singletonKey: mailAccountId, retryLimit: 3 },
  )
}

/** Enqueue a setup/renewal for one mailbox immediately after it connects. */
export async function queueMailPushSubscription(mailAccountId: string): Promise<void> {
  await sendJob(JOB_MAIL_PUSH_SUBSCRIPTION, { mailAccountId }, { singletonKey: mailAccountId, retryLimit: 3 })
}

function callbackUrl(path: string): string {
  if (!PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required to create mail push subscriptions.')
  return `${PUBLIC_BASE_URL}${path}`
}

function expiryFromEpoch(raw: string | number | null | undefined): Date {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('Provider push subscription response omitted its expiration.')
  return new Date(value)
}

function graphExpiry(): Date {
  return new Date(Date.now() + GRAPH_LIFETIME_MS)
}

async function saveSubscription(input: {
  mailAccountId: string
  kind: 'google_calendar' | 'microsoft_mail' | 'microsoft_calendar'
  remoteId: string
  verificationToken: string
  expiresAt: Date
  resourceId?: string | null
}): Promise<void> {
  await prisma.mailPushSubscription.upsert({
    where: { mailAccountId_kind: { mailAccountId: input.mailAccountId, kind: input.kind } },
    create: input,
    update: {
      remoteId: input.remoteId,
      verificationToken: input.verificationToken,
      expiresAt: input.expiresAt,
      resourceId: input.resourceId ?? null,
    },
  })
}

/** Create or renew every short-lived provider subscription for a mailbox. */
export async function renewMailPushSubscriptions(mailAccountId: string): Promise<void> {
  const account = await prisma.mailAccount.findFirst({
    where: { id: mailAccountId, user: { is: { enabled: true, memberships: { some: { isActive: true } } } } },
    select: { id: true, orgId: true, provider: true, connectionId: true },
  })
  if (!account) return

  const accessToken = await withFreshAccessToken(account.connectionId)
  if (account.provider === 'google') {
    if (!GOOGLE_PUBSUB_TOPIC) throw new Error('GOOGLE_PUBSUB_TOPIC is required to create Gmail watches.')
    const google = gmailClient(accessToken)
    const mailbox = await google.watchMailbox!(GOOGLE_PUBSUB_TOPIC)
    const gmailWatchExpiresAt = expiryFromEpoch(mailbox.expiration)
    await prisma.mailAccount.updateMany({
      where: { id: account.id, orgId: account.orgId },
      data: { gmailWatchExpiresAt },
    })
    const verificationToken = crypto.randomUUID()
    const channelId = crypto.randomUUID()
    const calendar = await google.watchCalendar!({
      id: channelId,
      address: callbackUrl('/api/mail-push/google-calendar'),
      token: verificationToken,
    })
    if (!calendar.id || !calendar.resourceId) throw new Error('Google Calendar watch response was incomplete.')
    await saveSubscription({
      mailAccountId: account.id,
      kind: 'google_calendar',
      remoteId: calendar.id,
      resourceId: calendar.resourceId,
      verificationToken,
      expiresAt: expiryFromEpoch(calendar.expiration),
    })
    return
  }

  if (account.provider !== 'microsoft') return
  const graph = graphClient(accessToken)
  for (const [kind, resource] of [
    ['microsoft_mail', 'me/messages'],
    ['microsoft_calendar', 'me/events'],
  ] as const) {
    const existing = await prisma.mailPushSubscription.findUnique({
      where: { mailAccountId_kind: { mailAccountId: account.id, kind } },
    })
    const expiresAt = graphExpiry()
    if (existing && existing.expiresAt.getTime() > Date.now() + GRAPH_RENEWAL_WINDOW_MS) continue
    if (existing) {
      const renewed = await graph.renewSubscription!(existing.remoteId, expiresAt.toISOString()) as { expirationDateTime?: string }
      await saveSubscription({ ...existing, kind: kind as 'microsoft_mail' | 'microsoft_calendar', expiresAt: renewed.expirationDateTime ? new Date(renewed.expirationDateTime) : expiresAt })
      continue
    }
    const verificationToken = crypto.randomUUID()
    const created = await graph.createSubscription!({
      changeType: 'created,updated,deleted',
      notificationUrl: callbackUrl('/api/mail-push/microsoft'),
      resource,
      expirationDateTime: expiresAt.toISOString(),
      clientState: verificationToken,
    }) as { id?: string; expirationDateTime?: string }
    if (!created.id) throw new Error('Microsoft Graph subscription response was incomplete.')
    await saveSubscription({
      mailAccountId: account.id,
      kind,
      remoteId: created.id,
      verificationToken,
      expiresAt: created.expirationDateTime ? new Date(created.expirationDateTime) : expiresAt,
    })
  }
}

/** Register the daily renewal dispatcher and the per-mailbox subscription worker. */
export async function registerMailPushSubscriptionWorker(): Promise<string> {
  return workJob<{ mailAccountId?: string }>(JOB_MAIL_PUSH_SUBSCRIPTION, { batchSize: 1 }, async (job) => {
    if (job.data.mailAccountId) return void (await renewMailPushSubscriptions(job.data.mailAccountId))
    const accounts = await prisma.mailAccount.findMany({
      where: { user: { is: { enabled: true, memberships: { some: { isActive: true } } } } },
      select: { id: true },
    })
    await Promise.all(accounts.map((account) => queueMailPushSubscription(account.id)))
  })
}

/** Check every active mailbox daily; each provider owns its shorter precise expiry. */
export async function scheduleMailPushSubscriptions(): Promise<void> {
  await scheduleJob(JOB_MAIL_PUSH_SUBSCRIPTION, MAIL_PUSH_SUBSCRIPTION_CRON)
}
