/**
 * Shared participant-identifier primitives for CRM activity matching.
 *
 * Sync sources use these before querying CRM records so email and calendar imports
 * treat addresses identically. Resolution and persistence deliberately live in the
 * same module as later slices of MAI-435; no source-specific matcher is allowed.
 */
import type { Prisma } from '../generated/prisma/client.js'
import type { Email, Meeting } from '../generated/prisma/client.js'
import { activityFromEmail, activityFromMeeting, recordActivityInTx } from '../crm/activityFeed.js'
import {
  DEFAULT_CAPTURE_SETTINGS,
  evaluateCaptureExclusions,
  type CaptureExclusion,
  type CaptureSettings,
} from './captureExclusions.js'

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'outlook.com',
  'yahoo.com',
])

export type ParticipantExclusion = 'invalid_address'

export interface ParticipantClassification {
  address: string
  eligibleForExactPerson: boolean
  eligibleForCompanyDomain: boolean
  exclusion: ParticipantExclusion | null
}

export interface CrmMatchParticipant {
  address: string
  isOrganizer?: boolean
  responseStatus?: string
}

export interface ResolveCrmParticipantsInput {
  orgId: string
  participants: CrmMatchParticipant[]
  occurredAt: Date
  direction?: 'inbound' | 'outbound'
  /** Sync providers identify these without the matcher parsing untrusted bodies. */
  isAutoReply?: boolean
  isBounce?: boolean
  /** The org's capture settings; defaults to the safe built-in policy. */
  captureSettings?: CaptureSettings
  /** The message subject, for subject-keyword excludes. */
  subject?: string | null
  /** Which activity type this message is, for the what-to-log rule. */
  activityType?: 'email' | 'meeting'
  /** True when the mailbox owner has opted their own mailbox out of capture. */
  optedOut?: boolean
}

export type CrmMatchExclusion =
  | ParticipantExclusion
  | 'auto_reply'
  | 'bounce'
  | CaptureExclusion

export interface ResolvedCrmParticipants {
  excluded: boolean
  exclusion: CrmMatchExclusion | null
  primaryPersonId: string | null
  primaryCompanyId: string | null
  /** Every linked Person, not only the one displayed in the primary feed row. */
  personIds: string[]
  /** Exact address → Person links, for updating participant rows on persistence. */
  personIdByAddress: Record<string, string>
  /** Every matched Company; the first item is the primary display company. */
  companyIds: string[]
  /** The single open deal chosen by the documented deterministic heuristic. */
  dealId: string | null
}

/** Normalize an RFC-style address for stored-address equality matching. */
export function normalizeParticipantAddress(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Return the progressively broader domain candidates used by company matching.
 * The public-suffix problem is deliberately out of scope here: a CRM company
 * domain is an identity supplied by the user, so trying `acme.com` after
 * `sub.acme.com` is useful while matching `co.uk` can never match a valid company
 * domain in this product's data model.
 */
export function candidateCompanyDomains(address: string): string[] {
  const domain = normalizeParticipantAddress(address).split('@')[1]
  if (!domain || domain.includes('..')) return []

  const labels = domain.split('.').filter(Boolean)
  if (labels.length < 2) return []

  const domains: string[] = []
  for (let index = 0; index <= labels.length - 2; index += 1) {
    domains.push(labels.slice(index).join('.'))
  }
  return domains
}

/**
 * Classify a single address for structural eligibility. Exact Person matching
 * intentionally survives a public domain, because an existing `jane@gmail.com`
 * is a high-confidence identity; only company-domain inference is disabled for
 * public mail hosts. Role-address exclusion is NOT here — it is a configurable
 * rule applied by the capture-exclusion evaluator (captureExclusions.ts).
 */
export function classifyParticipant(value: string): ParticipantClassification {
  const address = normalizeParticipantAddress(value)
  const [localPart, domain, ...rest] = address.split('@')
  if (!localPart || !domain || rest.length > 0 || !domain.includes('.')) {
    return {
      address,
      eligibleForExactPerson: false,
      eligibleForCompanyDomain: false,
      exclusion: 'invalid_address',
    }
  }
  return {
    address,
    eligibleForExactPerson: true,
    eligibleForCompanyDomain: !PUBLIC_EMAIL_DOMAINS.has(domain),
    exclusion: null,
  }
}

const NO_CRM_MATCH: ResolvedCrmParticipants = {
  excluded: false,
  exclusion: null,
  primaryPersonId: null,
  primaryCompanyId: null,
  personIds: [],
  personIdByAddress: {},
  companyIds: [],
  dealId: null,
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function dateValue(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

/**
 * Resolve a source's participants to existing CRM records inside one tenant.
 *
 * It only reads and returns links; callers persist those links together with the
 * activity in their transaction. Keeping the resolution reusable is what lets the
 * mailbox back-fill, live poll, rematcher, calendar import, and future sources
 * share one matching policy.
 */
export async function resolveParticipantsToCrm(
  db: Prisma.TransactionClient,
  input: ResolveCrmParticipantsInput,
): Promise<ResolvedCrmParticipants> {
  const orgId = input.orgId.trim()
  if (!orgId) return NO_CRM_MATCH

  if (input.isBounce) return { ...NO_CRM_MATCH, excluded: true, exclusion: 'bounce' }
  if (input.isAutoReply) return { ...NO_CRM_MATCH, excluded: true, exclusion: 'auto_reply' }

  // Step 2 — apply exclusions first, through the pluggable capture-exclusion
  // evaluator. It owns every configurable rule (role addresses, address/domain
  // excludes, internal-only, bulk inbound, subject keywords, what-to-log, opt-out).
  const exclusion = evaluateCaptureExclusions(input.captureSettings ?? DEFAULT_CAPTURE_SETTINGS, {
    participants: input.participants,
    subject: input.subject,
    direction: input.direction,
    activityType: input.activityType ?? 'email',
    optedOut: input.optedOut,
  })
  if (exclusion.excluded) {
    return { ...NO_CRM_MATCH, excluded: true, exclusion: exclusion.exclusion }
  }

  const classified = exclusion.eligibleParticipants.map((participant) => ({
    participant,
    classification: classifyParticipant(participant.address),
  }))
  const eligible = classified.filter(({ classification }) => classification.exclusion === null)
  const firstExclusion = classified.find(({ classification }) => classification.exclusion !== null)?.classification.exclusion
  if (eligible.length === 0) {
    return {
      ...NO_CRM_MATCH,
      excluded: true,
      exclusion: firstExclusion ?? 'invalid_address',
    }
  }

  const addresses = dedupe(eligible.map(({ classification }) => classification.address))
  const knownAddresses = eligible
    .filter(({ classification }) => classification.eligibleForExactPerson)
    .map(({ classification }) => classification.address)
  const personEmails = knownAddresses.length
    ? await db.personEmail.findMany({
        where: { orgId, address: { in: dedupe(knownAddresses) } },
        orderBy: { createdAt: 'asc' },
        select: { address: true, person: { select: { id: true, companyId: true } } },
      })
    : []
  const personByAddress = new Map<string, { id: string; companyId: string | null }>()
  for (const row of personEmails) {
    const address = normalizeParticipantAddress(row.address)
    if (!personByAddress.has(address)) personByAddress.set(address, row.person)
  }

  const exactPeople = addresses
    .map((address) => ({ address, person: personByAddress.get(address) }))
    .filter((match): match is { address: string; person: { id: string; companyId: string | null } } => Boolean(match.person))
  const personIds = dedupe(exactPeople.map(({ person }) => person.id))
  const personIdByAddress = Object.fromEntries(exactPeople.map(({ address, person }) => [address, person.id]))
  const exactCompanyIds = dedupe(
    exactPeople.flatMap(({ person }) => (person.companyId ? [person.companyId] : [])),
  )

  // Domain matching applies only where exact Person matching did not resolve the
  // address; a known contact's explicit company is stronger than their mail host.
  const domainCandidates = dedupe(
    eligible.flatMap(({ classification }) =>
      personByAddress.has(classification.address) || !classification.eligibleForCompanyDomain
        ? []
        : candidateCompanyDomains(classification.address),
    ),
  )
  const domainCompanies = domainCandidates.length
    ? await db.company.findMany({
        where: {
          orgId,
          OR: [{ domain: { in: domainCandidates } }, { alternateDomains: { hasSome: domainCandidates } }],
        },
        select: { id: true, domain: true, alternateDomains: true, updatedAt: true },
      })
    : []
  // A shared domain is not an ambiguity to discard: it is a legitimate attach to
  // every company. The most recently active (approximated by its current record
  // update time until activity rollups land) becomes the display primary.
  const rankedDomainCompanies = [...domainCompanies].sort(
    (left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt) || left.id.localeCompare(right.id),
  )
  const domainCompanyIds = rankedDomainCompanies.map(({ id }) => id)
  const companyIds = dedupe([...exactCompanyIds, ...domainCompanyIds])
  const primaryCompanyId = exactCompanyIds[0] ?? domainCompanyIds[0] ?? null

  const openDeals = companyIds.length
    ? await db.deal.findMany({
        where: { orgId, companyId: { in: companyIds }, status: 'open', isArchived: false, deletedAt: null },
        select: { id: true, ownerUserId: true, updatedAt: true },
      })
    : []
  if (openDeals.length === 0) {
    return {
      ...NO_CRM_MATCH,
      primaryPersonId: personIds[0] ?? null,
      primaryCompanyId,
      personIds,
      personIdByAddress,
      companyIds,
    }
  }

  const dealIds = openDeals.map((deal) => deal.id)
  const dealActivities = await db.activityEntry.findMany({
    where: { orgId, dealId: { in: dealIds } },
    select: { dealId: true, occurredAt: true },
  })
  const activityDistanceByDealId = new Map<string, number>()
  for (const activity of dealActivities) {
    if (!activity.dealId) continue
    const distance = Math.abs(activity.occurredAt.getTime() - input.occurredAt.getTime())
    const current = activityDistanceByDealId.get(activity.dealId)
    if (current === undefined || distance < current) activityDistanceByDealId.set(activity.dealId, distance)
  }

  const ownerUserIds = dedupe(openDeals.flatMap((deal) => (deal.ownerUserId ? [deal.ownerUserId] : [])))
  const owners = ownerUserIds.length
    ? await db.user.findMany({ where: { id: { in: ownerUserIds } }, select: { id: true, email: true } })
    : []
  const ownerEmailById = new Map(owners.map((owner) => [owner.id, normalizeParticipantAddress(owner.email)]))
  const participantWeightByAddress = new Map<string, number>()
  for (const { participant, classification } of eligible) {
    const weight = participant.isOrganizer ? 2 : participant.responseStatus === 'accepted' ? 1 : 0
    participantWeightByAddress.set(
      classification.address,
      Math.max(participantWeightByAddress.get(classification.address) ?? 0, weight),
    )
  }

  const rankedDeals = [...openDeals].sort((left, right) => {
    const leftWeight = left.ownerUserId ? participantWeightByAddress.get(ownerEmailById.get(left.ownerUserId) ?? '') ?? -1 : -1
    const rightWeight = right.ownerUserId ? participantWeightByAddress.get(ownerEmailById.get(right.ownerUserId) ?? '') ?? -1 : -1
    const leftDistance = activityDistanceByDealId.get(left.id) ?? Number.POSITIVE_INFINITY
    const rightDistance = activityDistanceByDealId.get(right.id) ?? Number.POSITIVE_INFINITY
    return (
      rightWeight - leftWeight ||
      leftDistance - rightDistance ||
      dateValue(right.updatedAt) - dateValue(left.updatedAt) ||
      left.id.localeCompare(right.id)
    )
  })
  return {
    ...NO_CRM_MATCH,
    primaryPersonId: personIds[0] ?? null,
    primaryCompanyId,
    personIds,
    personIdByAddress,
    companyIds,
    dealId: rankedDeals[0]?.id ?? null,
  }
}

type ActivityAttachmentTarget = { targetType: 'person' | 'company' | 'deal'; targetId: string; isPrimary: boolean }

function attachmentTargets(match: ResolvedCrmParticipants): ActivityAttachmentTarget[] {
  return [
    ...match.personIds.map((targetId) => ({ targetType: 'person' as const, targetId, isPrimary: targetId === match.primaryPersonId })),
    ...match.companyIds.map((targetId) => ({ targetType: 'company' as const, targetId, isPrimary: targetId === match.primaryCompanyId })),
    ...(match.dealId ? [{ targetType: 'deal' as const, targetId: match.dealId, isPrimary: true }] : []),
  ]
}

function canAttach(match: ResolvedCrmParticipants): boolean {
  return !match.excluded && attachmentTargets(match).length > 0
}

async function writeAttachmentTargets(
  tx: Prisma.TransactionClient,
  orgId: string,
  sourceType: 'email' | 'meeting',
  sourceId: string,
  targets: ActivityAttachmentTarget[],
): Promise<ActivityAttachmentTarget[]> {
  const existing = await tx.activityLink.findMany({
    where: { orgId, sourceType, sourceId },
    select: { targetType: true, targetId: true },
  })
  const existingKeys = new Set(existing.map((row) => `${row.targetType}:${row.targetId}`))
  const freshTargets = targets.filter((target) => !existingKeys.has(`${target.targetType}:${target.targetId}`))
  if (freshTargets.length) {
    await tx.activityLink.createMany({
      data: freshTargets.map((target) => ({
        orgId,
        sourceType,
        sourceId,
        targetType: target.targetType,
        targetId: target.targetId,
        isPrimary: target.isPrimary,
      })),
      skipDuplicates: true,
    })
  }
  return freshTargets
}

async function refreshDerivedActivityFields(
  tx: Prisma.TransactionClient,
  orgId: string,
  occurredAt: Date,
  targets: ActivityAttachmentTarget[],
): Promise<void> {
  const personIds = targets.filter((target) => target.targetType === 'person').map((target) => target.targetId)
  const companyIds = targets.filter((target) => target.targetType === 'company').map((target) => target.targetId)
  const dealIds = targets.filter((target) => target.targetType === 'deal').map((target) => target.targetId)
  await Promise.all([
    ...personIds.map((id) =>
      Promise.all([
        tx.person.updateMany({ where: { orgId, id }, data: { activityCount: { increment: 1 } } }),
        tx.person.updateMany({
          where: { orgId, id, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }] },
          data: { lastContactedAt: occurredAt },
        }),
      ]),
    ),
    ...companyIds.map((id) => tx.company.updateMany({ where: { orgId, id }, data: { activityCount: { increment: 1 } } })),
    ...dealIds.map((id) => tx.deal.updateMany({ where: { orgId, id }, data: { activityCount: { increment: 1 } } })),
  ])
}

/** Persist all automatic Email CRM links as one transaction slice. */
export async function attachEmailMatchInTx(
  tx: Prisma.TransactionClient,
  email: Email,
  match: ResolvedCrmParticipants,
): Promise<boolean> {
  if (email.manualAttach || !canAttach(match)) return false
  const links = attachmentTargets(match)
  const written = await tx.email.updateMany({
    where: { id: email.id, orgId: email.orgId, manualAttach: false },
    data: { companyId: match.primaryCompanyId, dealId: match.dealId },
  })
  if (written.count === 0) return false

  await Promise.all(
    Object.entries(match.personIdByAddress).map(([address, personId]) =>
      tx.emailParticipant.updateMany({ where: { orgId: email.orgId, emailId: email.id, address }, data: { personId } }),
    ),
  )
  const freshTargets = await writeAttachmentTargets(tx, email.orgId, 'email', email.id, links)
  await refreshDerivedActivityFields(tx, email.orgId, email.sentAt ?? email.receivedAt ?? email.createdAt, freshTargets)
  await recordActivityInTx(
    tx,
    activityFromEmail({ ...email, companyId: match.primaryCompanyId, dealId: match.dealId }, { personId: match.primaryPersonId }),
  )
  return true
}

/** Persist all automatic Meeting CRM links as one transaction slice. */
export async function attachMeetingMatchInTx(
  tx: Prisma.TransactionClient,
  meeting: Meeting,
  match: ResolvedCrmParticipants,
): Promise<boolean> {
  if (meeting.manualAttach || !canAttach(match)) return false
  const links = attachmentTargets(match)
  const written = await tx.meeting.updateMany({
    where: { id: meeting.id, orgId: meeting.orgId, manualAttach: false },
    data: {
      companyId: match.primaryCompanyId,
      dealId: match.dealId,
      organizerPersonId: meeting.organizerEmail ? match.personIdByAddress[normalizeParticipantAddress(meeting.organizerEmail)] ?? null : null,
    },
  })
  if (written.count === 0) return false

  await Promise.all(
    Object.entries(match.personIdByAddress).map(([email, personId]) =>
      tx.meetingAttendee.updateMany({ where: { orgId: meeting.orgId, meetingId: meeting.id, email }, data: { personId } }),
    ),
  )
  const freshTargets = await writeAttachmentTargets(tx, meeting.orgId, 'meeting', meeting.id, links)
  await refreshDerivedActivityFields(tx, meeting.orgId, meeting.startsAt, freshTargets)
  await recordActivityInTx(
    tx,
    activityFromMeeting({
      ...meeting,
      companyId: match.primaryCompanyId,
      dealId: match.dealId,
      organizerPersonId: meeting.organizerEmail ? match.personIdByAddress[normalizeParticipantAddress(meeting.organizerEmail)] ?? null : null,
    }),
  )
  return true
}
