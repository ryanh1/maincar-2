import prisma from '../db.js'
import { attachEmailMatchInTx, attachMeetingMatchInTx, resolveParticipantsToCrm } from '../lib/crmMatch.js'
import { getMailProvider } from '../lib/mail/getMailProvider.js'
import { JOB_MAIL_BACKFILL, sendJob, workJob } from './queue.js'

export interface MailBackfillPayload { mailAccountId: string }

export const MAIL_BACKFILL_PAGE_SIZE = 500
export const MAIL_BACKFILL_MONTHS = 12

function twelveMonthsAgo(now = new Date()): Date {
  const since = new Date(now)
  since.setUTCMonth(since.getUTCMonth() - MAIL_BACKFILL_MONTHS)
  return since
}

function emailProvider(provider: 'google' | 'microsoft'): 'gmail' | 'm365' {
  return provider === 'google' ? 'gmail' : 'm365'
}

function meetingProvider(provider: 'google' | 'microsoft'): 'google' | 'm365' {
  return provider === 'google' ? 'google' : 'm365'
}

function hasCrmMatch(match: Awaited<ReturnType<typeof resolveParticipantsToCrm>>): boolean {
  return !match.excluded && (match.personIds.length > 0 || match.companyIds.length > 0 || match.dealId !== null)
}

/** Enqueue one mailbox's first-connect import; pg-boss serializes it by mailbox. */
export function queueMailBackfill(mailAccountId: string): Promise<string | null> {
  return sendJob(JOB_MAIL_BACKFILL, { mailAccountId }, { singletonKey: mailAccountId, retryLimit: 5, retryDelay: 60 })
}

/** Resolve the mailbox after OAuth has committed, then start its import without exposing ids to the callback page. */
export async function queueMailBackfillForConnection(connectionId: string, orgId: string): Promise<void> {
  const account = await prisma.mailAccount.findFirst({
    where: { connectionId, orgId },
    select: { id: true },
  })
  if (account) await queueMailBackfill(account.id)
}

/** Process one bounded provider page so long mailboxes yield between pg-boss jobs. */
export async function mailBackfillJob({ mailAccountId }: MailBackfillPayload): Promise<void> {
  const account = await prisma.mailAccount.findUnique({
    where: { id: mailAccountId },
    select: { id: true, orgId: true, emailAddress: true },
  })
  if (!account) return

  const backfill = await prisma.mailBackfill.upsert({
    where: { mailAccountId },
    create: { orgId: account.orgId, mailAccountId },
    update: {},
  })
  if (backfill.status === 'complete') return

  const provider = await getMailProvider(account.id, account.orgId)
  const since = twelveMonthsAgo()
  const page = backfill.messagesComplete
    ? { messages: [], nextCursor: null }
    : await provider.listBackfillMessages(backfill.cursor, MAIL_BACKFILL_PAGE_SIZE, since)
  const eventPage = backfill.eventsComplete
    ? { events: [], nextCursor: null }
    : await provider.listBackfillEvents(backfill.eventCursor, MAIL_BACKFILL_PAGE_SIZE, since)
  let matchedCount = 0
  let meetingsMatchedCount = 0

  await prisma.$transaction(async (tx) => {
    for (const message of page.messages) {
      const match = await resolveParticipantsToCrm(tx, {
        orgId: account.orgId,
        participants: [message.from, ...message.to, ...message.cc].map((participant) => ({
          address: participant.email,
        })),
        occurredAt: message.sentAt,
        direction: message.isOutbound ? 'outbound' : 'inbound',
      })
      if (!hasCrmMatch(match)) continue

      const existing = await tx.email.findFirst({
        where: { orgId: account.orgId, mailAccountId, providerMessageId: message.providerMsgId },
        select: { id: true },
      })
      if (existing) continue

      const email = await tx.email.create({
        data: {
          orgId: account.orgId,
          mailAccountId,
          direction: message.isOutbound ? 'outbound' : 'inbound',
          subject: message.subject,
          bodyHtml: message.bodyHtml,
          bodyText: message.bodyText,
          snippet: message.bodyText?.slice(0, 240) ?? null,
          internetMessageId: `<${mailAccountId}.${message.providerMsgId}@maincar.backfill>`,
          conversationId: message.threadId,
          provider: emailProvider(provider.provider),
          providerMessageId: message.providerMsgId,
          providerThreadId: message.threadId,
          sentAt: message.sentAt,
          receivedAt: message.isOutbound ? null : message.sentAt,
          participants: {
            create: [
              { orgId: account.orgId, role: 'from', name: message.from.name ?? null, address: message.from.email },
              ...message.to.map((participant) => ({ orgId: account.orgId, role: 'to', name: participant.name ?? null, address: participant.email })),
              ...message.cc.map((participant) => ({ orgId: account.orgId, role: 'cc', name: participant.name ?? null, address: participant.email })),
            ],
          },
        },
      })
      if (await attachEmailMatchInTx(tx, email, match)) matchedCount += 1
    }

    for (const event of eventPage.events) {
      const participants = [event.organizer, ...event.attendees].filter(
        (participant): participant is NonNullable<typeof participant> => participant !== null && participant.email !== '',
      )
      const match = await resolveParticipantsToCrm(tx, {
        orgId: account.orgId,
        participants: participants.map((participant) => ({
          address: participant.email,
          isOrganizer: participant.email === event.organizer?.email,
        })),
        occurredAt: event.startsAt,
      })
      if (!hasCrmMatch(match)) continue

      const existing = await tx.meeting.findFirst({
        where: { orgId: account.orgId, provider: meetingProvider(provider.provider), providerEventId: event.providerEventId },
        select: { id: true },
      })
      if (existing) continue

      const attendeeByEmail = new Map(
        participants.map((participant) => [participant.email.toLowerCase(), participant]),
      )
      const meeting = await tx.meeting.create({
        data: {
          orgId: account.orgId,
          title: event.title ?? '(untitled event)',
          description: event.description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          isAllDay: event.isAllDay,
          provider: meetingProvider(provider.provider),
          providerEventId: event.providerEventId,
          organizerEmail: event.organizer?.email ?? null,
          attendees: {
            create: [...attendeeByEmail.values()].map((participant) => ({
              orgId: account.orgId,
              name: participant.name ?? null,
              email: participant.email,
              isOrganizer: participant.email === event.organizer?.email,
            })),
          },
        },
      })
      if (await attachMeetingMatchInTx(tx, meeting, match)) meetingsMatchedCount += 1
    }

    const messagesComplete = backfill.messagesComplete || page.nextCursor === null
    const eventsComplete = backfill.eventsComplete || eventPage.nextCursor === null
    const complete = messagesComplete && eventsComplete
    await tx.mailBackfill.updateMany({
      where: { mailAccountId },
      data: {
        cursor: page.nextCursor,
        eventCursor: eventPage.nextCursor,
        messagesComplete,
        eventsComplete,
        scannedCount: { increment: page.messages.length },
        matchedCount: { increment: matchedCount },
        eventsScannedCount: { increment: eventPage.events.length },
        meetingsMatchedCount: { increment: meetingsMatchedCount },
        status: complete ? 'complete' : 'running',
        completedAt: complete ? new Date() : null,
        errorMessage: null,
      },
    })
  })

  if (page.nextCursor || eventPage.nextCursor) await queueMailBackfill(mailAccountId)
}

export function registerMailBackfillWorker(): Promise<string> {
  return workJob<MailBackfillPayload>(JOB_MAIL_BACKFILL, { batchSize: 1 }, async (job) => {
    await mailBackfillJob(job.data)
  })
}
