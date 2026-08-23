import prisma from '../db.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { attachEmailMatchInTx, attachMeetingMatchInTx, resolveParticipantsToCrm } from '../lib/crmMatch.js'
import { getMailProvider } from '../lib/mail/getMailProvider.js'
import { CursorExpiredError, RateLimitedError } from '../lib/mail/mailErrors.js'
import type { CalendarEvent, InboundMessage, MailProvider } from '../lib/mail/MailProvider.js'
import { JOB_MAIL_SYNC, scheduleJob, sendJob, workJob } from './queue.js'

const PAGE_SIZE = 100
export const MAIL_SYNC_CRON = '*/5 * * * *'

type Db = Pick<PrismaClient, '$transaction' | 'mailAccount' | 'membership'>
type Tx = Prisma.TransactionClient

export type MailSyncResult = { skipped: boolean; emails: number; meetings: number; recovered: boolean }

type MailSyncPayload = { mailAccountId?: string; rateLimitRetries?: number }

function providerName(provider: MailProvider['provider']): 'gmail' | 'm365' {
  return provider === 'google' ? 'gmail' : 'm365'
}

function syntheticInternetMessageId(provider: MailProvider['provider'], providerMsgId: string): string {
  return `<${Buffer.from(`${provider}:${providerMsgId}`, 'utf8').toString('base64url')}@maincar-sync>`
}

function messageParticipants(message: InboundMessage) {
  return [
    { role: 'from', ...message.from },
    ...message.to.map((address) => ({ role: 'to', ...address })),
    ...message.cc.map((address) => ({ role: 'cc', ...address })),
  ].filter((participant) => participant.email.trim())
}

async function readPage<T>(
  cursor: string | null,
  read: (cursor: string | null) => Promise<T>,
): Promise<{ page: T; recovered: boolean }> {
  try {
    return { page: await read(cursor), recovered: false }
  } catch (error) {
    if (!(error instanceof CursorExpiredError) || cursor === null) throw error
    return { page: await read(null), recovered: true }
  }
}

async function persistMessage(
  tx: Tx,
  account: { id: string; orgId: string; provider: string; emailAddress: string },
  provider: MailProvider,
  message: InboundMessage,
) {
  const existing = await tx.email.findFirst({
    where: { orgId: account.orgId, mailAccountId: account.id, providerMessageId: message.providerMsgId },
    select: { id: true },
  })
  const data = {
    direction: message.isOutbound ? 'outbound' : 'inbound',
    subject: message.subject,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    internetMessageId: syntheticInternetMessageId(provider.provider, message.providerMsgId),
    conversationId: message.threadId,
    provider: providerName(provider.provider),
    providerMessageId: message.providerMsgId,
    providerThreadId: message.threadId,
    sentAt: message.isOutbound ? message.sentAt : null,
    receivedAt: message.isOutbound ? null : message.sentAt,
  }
  const participants = messageParticipants(message)
  const email = existing
    ? await (async () => {
        await tx.email.updateMany({ where: { id: existing.id, orgId: account.orgId }, data })
        await tx.emailParticipant.deleteMany({ where: { emailId: existing.id, orgId: account.orgId } })
        if (participants.length) {
          await tx.emailParticipant.createMany({
            data: participants.map((participant) => ({ orgId: account.orgId, emailId: existing.id, role: participant.role, name: participant.name ?? null, address: participant.email })),
          })
        }
        return tx.email.findFirstOrThrow({ where: { id: existing.id, orgId: account.orgId } })
      })()
    : await tx.email.create({
        data: {
          orgId: account.orgId,
          mailAccountId: account.id,
          ...data,
          participants: { create: participants.map((participant) => ({ orgId: account.orgId, role: participant.role, name: participant.name ?? null, address: participant.email })) },
        },
      })
  const match = await resolveParticipantsToCrm(tx, {
    orgId: account.orgId,
    participants: participants.map((participant) => ({ address: participant.email })),
    occurredAt: message.sentAt,
    internalDomains: account.emailAddress.split('@')[1] ? [account.emailAddress.split('@')[1]!] : [],
    direction: message.isOutbound ? 'outbound' : 'inbound',
  })
  await attachEmailMatchInTx(tx, email, match)
}

async function persistEvent(
  tx: Tx,
  account: { orgId: string },
  provider: MailProvider,
  event: CalendarEvent,
) {
  const providerValue = providerName(provider.provider)
  const existing = await tx.meeting.findFirst({
    where: { orgId: account.orgId, provider: providerValue, providerEventId: event.providerEventId },
    select: { id: true },
  })
  const attendees = event.attendees.filter((attendee) => attendee.email.trim())
  const data = {
    title: event.title ?? '(Untitled event)',
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isAllDay: event.isAllDay,
    timeZone: null,
    organizerEmail: event.organizer?.email ?? null,
    provider: providerValue,
    providerEventId: event.providerEventId,
  }
  const meeting = existing
    ? await (async () => {
        await tx.meeting.updateMany({ where: { id: existing.id, orgId: account.orgId }, data })
        await tx.meetingAttendee.deleteMany({ where: { meetingId: existing.id, orgId: account.orgId } })
        if (attendees.length) {
          await tx.meetingAttendee.createMany({
            data: attendees.map((attendee) => ({ orgId: account.orgId, meetingId: existing.id, email: attendee.email, name: attendee.name ?? null })),
          })
        }
        return tx.meeting.findFirstOrThrow({ where: { id: existing.id, orgId: account.orgId } })
      })()
    : await tx.meeting.create({
        data: {
          orgId: account.orgId,
          ...data,
          attendees: { create: attendees.map((attendee) => ({ orgId: account.orgId, email: attendee.email, name: attendee.name ?? null })) },
        },
      })
  const participants = [...attendees.map((attendee) => ({ address: attendee.email })), ...(event.organizer ? [{ address: event.organizer.email, isOrganizer: true }] : [])]
  const match = await resolveParticipantsToCrm(tx, { orgId: account.orgId, participants, occurredAt: event.startsAt })
  await attachMeetingMatchInTx(tx, meeting, match)
}

/** Sync a single bounded provider page for one active mailbox and checkpoint both cursors atomically. */
export async function syncMailAccount(mailAccountId: string, db: Db = prisma): Promise<MailSyncResult> {
  const account = await db.mailAccount.findFirst({
    where: { id: mailAccountId },
    select: { id: true, orgId: true, userId: true, provider: true, emailAddress: true, mailSyncCursor: true, calendarSyncCursor: true, user: { select: { enabled: true } } },
  })
  if (!account || !account.user.enabled) return { skipped: true, emails: 0, meetings: 0, recovered: false }
  const membership = await db.membership.findFirst({ where: { orgId: account.orgId, userId: account.userId, isActive: true }, select: { id: true } })
  if (!membership) return { skipped: true, emails: 0, meetings: 0, recovered: false }

  const provider = await getMailProvider(account.id, account.orgId)
  const messages = await readPage(account.mailSyncCursor, (cursor) => provider.listMessagesSince(cursor, PAGE_SIZE))
  const events = await readPage(account.calendarSyncCursor, (cursor) => provider.listEventsSince(cursor, PAGE_SIZE))
  await db.$transaction(async (tx) => {
    for (const message of messages.page.messages) await persistMessage(tx, account, provider, message)
    for (const event of events.page.events) await persistEvent(tx, account, provider, event)
    await tx.mailAccount.updateMany({
      where: { id: account.id, orgId: account.orgId, userId: account.userId },
      data: { mailSyncCursor: messages.page.nextCursor, calendarSyncCursor: events.page.nextCursor, lastSyncedAt: new Date() },
    })
  })
  return { skipped: false, emails: messages.page.messages.length, meetings: events.page.events.length, recovered: messages.recovered || events.recovered }
}

async function enqueueActiveMailboxes(db: Db = prisma): Promise<void> {
  const accounts = await db.mailAccount.findMany({
    where: { user: { is: { enabled: true, memberships: { some: { isActive: true } } } } },
    select: { id: true },
  })
  await Promise.all(accounts.map((account) => sendJob(JOB_MAIL_SYNC, { mailAccountId: account.id }, { singletonKey: account.id, retryLimit: 3 })))
}

/** Attach the recurring dispatcher and per-account workers. */
export async function registerMailSyncWorker(): Promise<string> {
  return workJob<MailSyncPayload>(JOB_MAIL_SYNC, { batchSize: 1 }, async (job) => {
    if (!job.data.mailAccountId) return void (await enqueueActiveMailboxes())
    try {
      await syncMailAccount(job.data.mailAccountId)
    } catch (error) {
      const rateLimitRetries = job.data.rateLimitRetries ?? 0
      if (!(error instanceof RateLimitedError) || rateLimitRetries >= job.retryLimit) throw error
      await sendJob(
        JOB_MAIL_SYNC,
        { mailAccountId: job.data.mailAccountId, rateLimitRetries: rateLimitRetries + 1 },
        {
          singletonKey: job.data.mailAccountId,
          retryLimit: job.retryLimit,
          startAfter: new Date(Date.now() + error.retryAfterMs),
        },
      )
    }
  })
}

/** Queue the account dispatcher every five minutes. */
export async function scheduleMailSync(): Promise<void> {
  await scheduleJob(JOB_MAIL_SYNC, MAIL_SYNC_CRON)
}
