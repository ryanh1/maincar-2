import type { Prisma } from '../generated/prisma/client.js'

import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import {
  attachEmailMatchInTx,
  candidateCompanyDomains,
  normalizeParticipantAddress,
  resolveParticipantsToCrm,
} from '../lib/crmMatch.js'
import { JOB_MAIL_REMATCH, sendJob, workJob } from './queue.js'

export const MAIL_REMATCH_RETRY_LIMIT = 3
export const MAIL_REMATCH_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

export interface HeldEmailParticipant {
  role: string
  address: string
  name?: string | null
}

export interface HeldEmailInput {
  orgId: string
  sourceKey: string
  occurredAt: Date
  email: {
    mailAccountId?: string | null
    direction: 'inbound' | 'outbound'
    subject?: string | null
    bodyHtml?: string | null
    bodyText?: string | null
    snippet?: string | null
    internetMessageId: string
    conversationId?: string | null
    inReplyTo?: string | null
    references?: string[]
    importance?: string
    isRead?: boolean
    hasAttachments?: boolean
    provider?: string | null
    providerMessageId?: string | null
    providerThreadId?: string | null
    folderOrLabels?: string[]
    webLink?: string | null
    syncCursor?: string | null
    sentAt?: Date | null
    receivedAt?: Date | null
  }
  participants: HeldEmailParticipant[]
}

export interface MailRematchPayload {
  orgId: string
  recordType: 'person' | 'company'
  recordId: string
}

export interface MailRematchResult {
  heldScanned: number
  heldAttached: number
  recentScanned: number
  recentAttached: number
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizedParticipantMetadata(participants: HeldEmailParticipant[]) {
  const participantAddresses = unique(participants.map(({ address }) => normalizeParticipantAddress(address)))
  return {
    participantAddresses,
    participantDomainCandidates: unique(participantAddresses.flatMap(candidateCompanyDomains)),
  }
}

/**
 * Persist a zero-match email outside CRM tables. Its retention is intentionally
 * left to F6: rematching is an attach path, never a second scheduler.
 */
export async function holdUnmatchedEmailInTx(
  tx: Prisma.TransactionClient,
  input: HeldEmailInput,
): Promise<void> {
  const metadata = normalizedParticipantMetadata(input.participants)
  // Prisma JSON cannot carry Dates. Serializing makes the durable payload explicit
  // and rehydrates the same ISO timestamps when the job later creates the Email.
  const payload = JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue
  await tx.unmatchedActivity.upsert({
    where: {
      orgId_sourceType_sourceKey: { orgId: input.orgId, sourceType: 'email', sourceKey: input.sourceKey },
    },
    create: {
      orgId: input.orgId,
      sourceType: 'email',
      sourceKey: input.sourceKey,
      occurredAt: input.occurredAt,
      ...metadata,
      payload,
    },
    update: {
      occurredAt: input.occurredAt,
      ...metadata,
      payload,
    },
  })
}

function readHeldEmail(value: unknown): HeldEmailInput | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HeldEmailInput>
  if (
    typeof candidate.orgId !== 'string' ||
    typeof candidate.sourceKey !== 'string' ||
    !candidate.email ||
    typeof candidate.email.internetMessageId !== 'string' ||
    !Array.isArray(candidate.participants)
  ) {
    return null
  }
  const occurredAt = candidate.occurredAt instanceof Date ? candidate.occurredAt : new Date(String(candidate.occurredAt))
  if (Number.isNaN(occurredAt.getTime())) return null
  return { ...candidate, occurredAt } as HeldEmailInput
}

function dateOrNull(value: Date | string | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) return value
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

async function createHeldEmailInTx(tx: Prisma.TransactionClient, held: HeldEmailInput) {
  const existing = await tx.email.findFirst({
    where: {
      orgId: held.orgId,
      mailAccountId: held.email.mailAccountId ?? null,
      internetMessageId: held.email.internetMessageId,
    },
  })
  if (existing) return existing

  return tx.email.create({
    data: {
      orgId: held.orgId,
      mailAccountId: held.email.mailAccountId,
      direction: held.email.direction,
      subject: held.email.subject,
      bodyHtml: held.email.bodyHtml,
      bodyText: held.email.bodyText,
      snippet: held.email.snippet,
      internetMessageId: held.email.internetMessageId,
      conversationId: held.email.conversationId,
      inReplyTo: held.email.inReplyTo,
      references: held.email.references ?? [],
      importance: held.email.importance ?? 'normal',
      isRead: held.email.isRead ?? false,
      hasAttachments: held.email.hasAttachments ?? false,
      provider: held.email.provider,
      providerMessageId: held.email.providerMessageId,
      providerThreadId: held.email.providerThreadId,
      folderOrLabels: held.email.folderOrLabels ?? [],
      webLink: held.email.webLink,
      syncCursor: held.email.syncCursor,
      sentAt: dateOrNull(held.email.sentAt),
      receivedAt: dateOrNull(held.email.receivedAt),
      participants: {
        create: held.participants.map((participant) => ({
          orgId: held.orgId,
          role: participant.role,
          name: participant.name,
          address: participant.address,
        })),
      },
    },
  })
}

async function loadRecordIdentifiers(payload: MailRematchPayload): Promise<string[]> {
  if (payload.recordType === 'person') {
    const person = await prisma.person.findFirst({
      where: { id: payload.recordId, orgId: payload.orgId, deletedAt: null },
      select: { addresses: { select: { address: true } } },
    })
    return person ? unique(person.addresses.map(({ address }) => normalizeParticipantAddress(address))) : []
  }

  const company = await prisma.company.findFirst({
    where: { id: payload.recordId, orgId: payload.orgId, deletedAt: null },
    select: { domain: true, alternateDomains: true },
  })
  return company ? unique([company.domain, ...company.alternateDomains].filter((value): value is string => Boolean(value))) : []
}

function participantFilter(recordType: MailRematchPayload['recordType'], identifiers: string[]) {
  if (recordType === 'person') return { address: { in: identifiers } }
  return { OR: identifiers.map((domain) => ({ address: { endsWith: domain } })) }
}

export async function rematchMailActivityJob(
  payload: MailRematchPayload,
  now: Date = new Date(),
): Promise<MailRematchResult> {
  const identifiers = await loadRecordIdentifiers(payload)
  const empty: MailRematchResult = { heldScanned: 0, heldAttached: 0, recentScanned: 0, recentAttached: 0 }
  if (identifiers.length === 0) return empty

  const holdWhere = payload.recordType === 'person'
    ? { orgId: payload.orgId, sourceType: 'email', participantAddresses: { hasSome: identifiers } }
    : { orgId: payload.orgId, sourceType: 'email', participantDomainCandidates: { hasSome: identifiers } }
  const recentAfter = new Date(now.getTime() - MAIL_REMATCH_LOOKBACK_MS)
  const filter = participantFilter(payload.recordType, identifiers)
  const [heldRows, recentEmails] = await Promise.all([
    prisma.unmatchedActivity.findMany({ where: holdWhere, select: { id: true, orgId: true, payload: true } }),
    prisma.email.findMany({
      where: {
        orgId: payload.orgId,
        OR: [{ sentAt: { gte: recentAfter } }, { receivedAt: { gte: recentAfter } }, { createdAt: { gte: recentAfter } }],
        participants: { some: filter },
      },
      include: { participants: true },
    }),
  ])

  let heldAttached = 0
  let recentAttached = 0
  await prisma.$transaction(async (tx) => {
    for (const row of heldRows) {
      const held = readHeldEmail(row.payload)
      if (!held || held.orgId !== payload.orgId) {
        logger.warn({ orgId: payload.orgId, unmatchedActivityId: row.id }, 'mail rematch: invalid hold payload, leaving it for retention')
        continue
      }
      const match = await resolveParticipantsToCrm(tx, {
        orgId: held.orgId,
        participants: held.participants,
        occurredAt: held.occurredAt,
        direction: held.email.direction,
        subject: held.email.subject,
        activityType: 'email',
      })
      if (match.excluded || (match.personIds.length === 0 && match.companyIds.length === 0 && !match.dealId)) continue

      const email = await createHeldEmailInTx(tx, held)
      if (await attachEmailMatchInTx(tx, email, match)) {
        await tx.unmatchedActivity.deleteMany({ where: { id: row.id, orgId: payload.orgId } })
        heldAttached += 1
      }
    }

    for (const email of recentEmails) {
      const match = await resolveParticipantsToCrm(tx, {
        orgId: email.orgId,
        participants: email.participants.map(({ address }) => ({ address })),
        occurredAt: email.sentAt ?? email.receivedAt ?? email.createdAt,
        direction: email.direction as 'inbound' | 'outbound',
        subject: email.subject,
        activityType: 'email',
      })
      if (await attachEmailMatchInTx(tx, email, match)) recentAttached += 1
    }
  })

  return { heldScanned: heldRows.length, heldAttached, recentScanned: recentEmails.length, recentAttached }
}

/** Enqueue one create-triggered rematch; pg-boss coalesces repeats per new record. */
export function queueMailRematch(payload: MailRematchPayload): Promise<string | null> {
  return sendJob(JOB_MAIL_REMATCH, payload, { retryLimit: MAIL_REMATCH_RETRY_LIMIT, singletonKey: payload.recordId })
}

/** Register the worker from index.ts, never from app.ts. */
export async function registerMailRematchWorker(): Promise<string> {
  return workJob<MailRematchPayload>(JOB_MAIL_REMATCH, { batchSize: 1 }, async (job) => {
    await rematchMailActivityJob(job.data)
  })
}
