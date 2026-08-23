import prisma from '../db.js'
import { attachEmailMatchInTx, resolveParticipantsToCrm } from '../lib/crmMatch.js'
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
  const page = await provider.listBackfillMessages(backfill.cursor, MAIL_BACKFILL_PAGE_SIZE, twelveMonthsAgo())
  let matchedCount = 0

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

    await tx.mailBackfill.updateMany({
      where: { mailAccountId },
      data: {
        cursor: page.nextCursor,
        scannedCount: { increment: page.messages.length },
        matchedCount: { increment: matchedCount },
        status: page.nextCursor ? 'running' : 'complete',
        completedAt: page.nextCursor ? null : new Date(),
        errorMessage: null,
      },
    })
  })

  if (page.nextCursor) await queueMailBackfill(mailAccountId)
}

export function registerMailBackfillWorker(): Promise<string> {
  return workJob<MailBackfillPayload>(JOB_MAIL_BACKFILL, { batchSize: 1 }, async (job) => {
    await mailBackfillJob(job.data)
  })
}
