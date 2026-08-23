/**
 * Person routes — the thing we dial, the centre of the product (MAI-130, T2).
 *
 * Mounted at /api/orgs/:orgId/people. The org lives in the path, not in the
 * caller's `currentOrgId`, so the tenant boundary is re-proven per request; every
 * route requires auth and an active membership in the org named by the path.
 *
 * The routes below carry the two rules the database CANNOT enforce (spec §5.11):
 *
 *   1. Identity anchor (§5.15) — a person needs at least one of a name part, an
 *      email, a phone, or linkedinUrl. The rule spans nullable columns AND the
 *      child phone/email rows, so it is checked here, at create/update time.
 *   2. Primary invariant — at most one primary phone (and one primary email); if a
 *      person has ≥1 phone, exactly one is primary. Adding the first value makes it
 *      primary; deleting the primary auto-promotes another. A boolean column cannot
 *      see its siblings, so this is reconciled in a transaction after every change.
 *
 * Dialable values are ROWS with their own status (reachable | unverified | dead),
 * not columns: a dialer must know which numbers are dead, and a dead number is
 * RETAINED, never deleted (spec §5.5). Re-adding the same e164/address is
 * idempotent under @@unique([personId, e164]) / @@unique([personId, address]) — it
 * merges into the existing row rather than erroring or duplicating.
 *
 * The tenant boundary is the orgId filter on every read AND write: single-record
 * reads go through findFirst({ where: { id, orgId } }) and writes through
 * updateMany({ where: { id, orgId } }), never update-by-id
 * (.claude/rules/database-and-prisma.md).
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { activityFromRecordCreated, recordActivityInTx } from '../crm/activityFeed.js'
import { queueMailRematch } from '../jobs/mailRematch.js'
import {
  diffFieldValues,
  loadHistoryAttributes,
  recordFieldHistoryInTx,
} from '../crm/fieldHistory.js'
import type { Person, PersonPhone, PersonEmail, Prisma } from '../generated/prisma/client.js'

// mergeParams so :orgId from the mount path reaches req.params here — without it
// the tenant filter would silently read undefined.
const router = Router({ mergeParams: true })

// --- Fixed system enums (spec §5.6a): plain String columns + a TS union here,
// never a Prisma enum. The user cannot add values; app code branches on them. ---
const ATTENTION_STATUSES = ['on_deck', 'on_hold', 'backburner', 'disqualified'] as const
const PERSONAS = ['decision_maker', 'gatekeeper', 'champion', 'influencer', 'user', 'other'] as const
const PHONE_LABELS = ['mobile', 'direct', 'work', 'main', 'home', 'other'] as const
const EMAIL_LABELS = ['work', 'personal', 'other'] as const
const VALUE_STATUSES = ['reachable', 'unverified', 'dead'] as const
const LINE_TYPES = ['mobile', 'landline', 'voip'] as const

// --- Mappers: database row → API shape ---
// orgId is deliberately absent — the caller already knows it (it is the path).
// mergedIntoId / deletedById are internal bookkeeping and not exposed.

function mapPhoneToApi(phone: PersonPhone) {
  return {
    id: phone.id,
    personId: phone.personId,
    e164: phone.e164,
    extension: phone.extension,
    label: phone.label,
    status: phone.status,
    reason: phone.reason,
    isDnc: phone.isDnc,
    dncReason: phone.dncReason,
    lineType: phone.lineType,
    lineTypeCheckedAt: phone.lineTypeCheckedAt ? phone.lineTypeCheckedAt.toISOString() : null,
    source: phone.source,
    isPrimary: phone.isPrimary,
    position: phone.position,
    timesDialed: phone.timesDialed,
    lastDialedAt: phone.lastDialedAt ? phone.lastDialedAt.toISOString() : null,
    timesConnected: phone.timesConnected,
    lastConnectedAt: phone.lastConnectedAt ? phone.lastConnectedAt.toISOString() : null,
    bestTimeToCall: phone.bestTimeToCall,
    lastVerifiedAt: phone.lastVerifiedAt ? phone.lastVerifiedAt.toISOString() : null,
    createdAt: phone.createdAt.toISOString(),
    updatedAt: phone.updatedAt.toISOString(),
  }
}

function mapEmailToApi(email: PersonEmail) {
  return {
    id: email.id,
    personId: email.personId,
    address: email.address,
    label: email.label,
    status: email.status,
    reason: email.reason,
    isDnc: email.isDnc,
    dncReason: email.dncReason,
    source: email.source,
    isPrimary: email.isPrimary,
    lastVerifiedAt: email.lastVerifiedAt ? email.lastVerifiedAt.toISOString() : null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  }
}

// displayName is computed here so every client renders the same fallback (§5.15):
// preferredFirstName ?? firstName (+ lastName), else the primary/first email, else "Unknown".
function displayName(
  person: Person,
  phones: PersonPhone[] = [],
  emails: PersonEmail[] = [],
): string {
  const first = person.preferredFirstName ?? person.firstName
  const full = [first, person.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  const email = emails.find((e) => e.isPrimary) ?? emails[0]
  if (email) return email.address
  // A phone is an anchor too, so a phone-only person still shows something.
  const phone = phones.find((p) => p.isPrimary) ?? phones[0]
  if (phone) return phone.e164
  return 'Unknown'
}

function mapPersonToApi(
  person: Person & { phones?: PersonPhone[]; addresses?: PersonEmail[] },
) {
  const phones = person.phones ?? []
  const emails = person.addresses ?? []
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    preferredFirstName: person.preferredFirstName,
    displayName: displayName(person, phones, emails),
    title: person.title,
    linkedinUrl: person.linkedinUrl,
    companyId: person.companyId,
    ownerUserId: person.ownerUserId,
    timeZone: person.timeZone,
    persona: person.persona,
    attentionStatus: person.attentionStatus,
    attentionReason: person.attentionReason,
    callbackDate: person.callbackDate ? person.callbackDate.toISOString() : null,
    source: person.source,
    lastContactedAt: person.lastContactedAt ? person.lastContactedAt.toISOString() : null,
    nameAudioUrl: person.nameAudioUrl,
    customJson: person.customJson,
    isArchived: person.isArchived,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    phones: phones.map(mapPhoneToApi),
    emails: emails.map(mapEmailToApi),
  }
}

// --- Normalization: empty → absent (spec §5.11) ---

// A trimmed non-empty string, or undefined. "" and whitespace collapse to
// undefined so a cleared field is stored absent, never as an empty string.
function blankToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

// A trimmed non-empty string, or NULL. Used on UPDATE where the client explicitly
// clears a field: "" / null both mean "store NULL", an absent key means unchanged.
function blankToNull(value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const optionalText = z.preprocess(blankToUndefined, z.string().optional())

// --- E.164 normalization (spec §5.5) ---
// The dialer stores one canonical shape. Strip spaces/dashes/parens/dots; a bare
// 10-digit number is assumed North-American (+1); an 11-digit 1xxxxxxxxxx gets a
// +; anything already +-prefixed is kept. The result is validated below.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/

export function normalizeE164(raw: string): string {
  const stripped = raw.trim().replace(/[\s().-]/g, '')
  if (stripped.startsWith('+')) return stripped
  const digits = stripped.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

// ============================================================
// Zod bodies
// ============================================================

// A phone as it can be written (create person, add phone, or re-add). e164 is the
// only required field; the rest have schema defaults.
const phoneInputSchema = z.object({
  e164: z.string({ error: 'A phone needs an e164 number.' }).trim().min(1, 'A phone needs an e164 number.'),
  extension: optionalText,
  label: z.enum(PHONE_LABELS, { error: `label is one of: ${PHONE_LABELS.join(', ')}.` }).optional(),
  status: z.enum(VALUE_STATUSES, { error: `status is one of: ${VALUE_STATUSES.join(', ')}.` }).optional(),
  reason: optionalText,
  isDnc: z.boolean().optional(),
  dncReason: optionalText,
  lineType: z.enum(LINE_TYPES, { error: `lineType is one of: ${LINE_TYPES.join(', ')}.` }).optional(),
  source: optionalText,
  isPrimary: z.boolean().optional(),
  bestTimeToCall: optionalText,
})

const emailInputSchema = z.object({
  address: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string({ error: 'An email needs an address.' }).email('Enter a valid email address.'),
  ),
  label: z.enum(EMAIL_LABELS, { error: `label is one of: ${EMAIL_LABELS.join(', ')}.` }).optional(),
  status: z.enum(VALUE_STATUSES, { error: `status is one of: ${VALUE_STATUSES.join(', ')}.` }).optional(),
  reason: optionalText,
  isDnc: z.boolean().optional(),
  dncReason: optionalText,
  source: optionalText,
  isPrimary: z.boolean().optional(),
})

// The writable Person body shared by create and update. Everything is optional;
// the identity-anchor rule is checked after parsing, against the merged result.
const personBodySchema = z.object({
  firstName: optionalText,
  lastName: optionalText,
  preferredFirstName: optionalText,
  title: optionalText,
  linkedinUrl: optionalText,
  companyId: z.preprocess(blankToUndefined, z.string().optional()),
  ownerUserId: z.preprocess(blankToUndefined, z.string().optional()),
  timeZone: optionalText,
  persona: z.enum(PERSONAS, { error: `persona is one of: ${PERSONAS.join(', ')}.` }).optional(),
  attentionStatus: z
    .enum(ATTENTION_STATUSES, { error: `attentionStatus is one of: ${ATTENTION_STATUSES.join(', ')}.` })
    .optional(),
  attentionReason: optionalText,
  callbackDate: z.preprocess(
    blankToUndefined,
    z.iso.datetime({ error: 'callbackDate must be an ISO-8601 timestamp.' }).optional(),
  ),
  source: optionalText,
  nameAudioUrl: optionalText,
  customJson: z.record(z.string(), z.unknown()).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  isArchived: z.boolean().optional(),
  // Nested children accepted ONLY on create, so a person can be created with just a
  // phone or email as its anchor (§5.15). Update touches children via /phones and
  // /emails sub-routes.
  phones: z.array(phoneInputSchema).optional(),
  emails: z.array(emailInputSchema).optional(),
})

const ANCHOR_ERROR =
  'A person needs at least one of a name, an email, a phone, or a LinkedIn URL.'

// True when the person has at least one identity anchor (spec §5.15). A phone or
// email counts, so callers pass how many of each the merged person would have.
function hasAnchor(fields: {
  firstName?: string | null
  lastName?: string | null
  preferredFirstName?: string | null
  linkedinUrl?: string | null
  phoneCount: number
  emailCount: number
}): boolean {
  return Boolean(
    fields.firstName ||
      fields.lastName ||
      fields.preferredFirstName ||
      fields.linkedinUrl ||
      fields.phoneCount > 0 ||
      fields.emailCount > 0,
  )
}

// Prisma's unique-constraint violation, duck-typed so the route does not depend on
// which error class the generated client exports.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

// A validated e164, or a 400-shaped error. Returns { e164 } on success.
function parseE164(raw: string): { e164: string } | { error: string } {
  const e164 = normalizeE164(raw)
  if (!E164_PATTERN.test(e164)) {
    return { error: 'Enter a valid phone number in E.164 form, like +12025550123.' }
  }
  return { e164 }
}

// ============================================================
// Primary invariant (spec §5.11)
// ============================================================
// Reconcile so that, when a person has ≥1 value, EXACTLY one is primary. Runs
// inside the caller's transaction. `preferId`, when it still exists, wins the
// primary slot (a caller asked for it); otherwise an already-primary row keeps it,
// else the oldest row is promoted. A person with zero values has zero primaries.
//
// The delegate is the minimal slice both PersonPhone and PersonEmail expose, so
// one function serves both without an `any`.
export interface PrimaryDelegate {
  findMany(args: {
    where: { personId: string; orgId: string }
    orderBy: { createdAt: 'asc' }
    select: { id: true; isPrimary: true }
  }): Promise<Array<{ id: string; isPrimary: boolean }>>
  updateMany(args: {
    where: Record<string, unknown>
    data: { isPrimary: boolean }
  }): Promise<{ count: number }>
}

export async function reconcilePrimary(
  delegate: PrimaryDelegate,
  personId: string,
  orgId: string,
  preferId?: string,
): Promise<void> {
  const rows = await delegate.findMany({
    where: { personId, orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, isPrimary: true },
  })
  if (rows.length === 0) return

  const chosen =
    (preferId && rows.some((r) => r.id === preferId) ? preferId : undefined) ??
    rows.find((r) => r.isPrimary)?.id ??
    rows[0].id

  // Promote the chosen row and demote every other. Both writes stay org-scoped.
  await delegate.updateMany({
    where: { personId, orgId, id: chosen, isPrimary: false },
    data: { isPrimary: true },
  })
  await delegate.updateMany({
    where: { personId, orgId, id: { not: chosen }, isPrimary: true },
    data: { isPrimary: false },
  })
}

/** The phone-specific companion to reconcilePrimary: it keeps the primary row
 * first and every remaining row in one contiguous, durable position order. */
export interface PhoneOrderDelegate {
  findMany(args: {
    where: { personId: string; orgId: string }
    orderBy: Array<{ position: 'asc' } | { createdAt: 'asc' } | { id: 'asc' }>
    select: { id: true; isPrimary: true; position: true }
  }): Promise<Array<{ id: string; isPrimary: boolean; position: number }>>
  updateMany(args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }): Promise<{ count: number }>
}

export async function reconcilePhoneOrder(
  delegate: PhoneOrderDelegate,
  personId: string,
  orgId: string,
  preferId?: string,
): Promise<void> {
  const rows = await delegate.findMany({
    where: { personId, orgId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, isPrimary: true, position: true },
  })
  if (rows.length === 0) return

  const primaryId =
    (preferId && rows.some((row) => row.id === preferId) ? preferId : undefined) ??
    rows.find((row) => row.isPrimary)?.id ??
    rows[0].id
  const ordered = [
    rows.find((row) => row.id === primaryId)!,
    ...rows.filter((row) => row.id !== primaryId),
  ]

  // Shift every row out of the target range before assigning contiguous positions.
  // This makes a primary promotion safe under @@unique([personId, position]).
  await delegate.updateMany({
    where: { personId, orgId },
    data: { position: { increment: rows.length } },
  })
  await Promise.all(ordered.map((row, position) => delegate.updateMany({
    where: { id: row.id, personId, orgId },
    data: { isPrimary: row.id === primaryId, position },
  })))
}

// ============================================================
// List input
// ============================================================
export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100

const SORT_FIELDS = ['createdAt', 'firstName', 'lastName'] as const

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z
    .enum(SORT_FIELDS, { error: `Sort by one of: ${SORT_FIELDS.join(', ')}.` })
    .default('createdAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),
  q: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(1).optional(),
  ),
  // Filter to one company's people, when set.
  companyId: z.preprocess(blankToUndefined, z.string().optional()),
  includeArchived: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean().optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/people — the org's people
// ============================================================
// Paginated, sortable, searchable by name; trashed rows (deletedAt set) excluded.
// The count and the page read against the SAME where clause so `total` and the
// rows can never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/people', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit, sort, dir, q, companyId, includeArchived } = parsed.data

    // --- Build filters ---
    const where: Prisma.PersonWhereInput = {
      orgId,
      deletedAt: null,
      ...(includeArchived ? {} : { isArchived: false }),
      ...(companyId ? { companyId } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' as const } },
              { lastName: { contains: q, mode: 'insensitive' as const } },
              { preferredFirstName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    const orderBy =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: dir }, { createdAt: 'desc' as const }]
    const [total, people] = await Promise.all([
      prisma.person.count({ where }),
      prisma.person.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { phones: true, addresses: true },
      }),
    ])

    // --- Return response ---
    res.json({ people: people.map(mapPersonToApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/people/:id — one person, with phones and emails
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/people/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const person = await prisma.person.findFirst({
      where: { id, orgId, deletedAt: null },
      include: { phones: true, addresses: true },
    })
    if (!person) {
      return void res.status(404).json({ error: 'Person not found' })
    }

    // --- Return response ---
    res.json({ person: mapPersonToApi(person) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/people — create a person (optionally with phones/emails)
// ============================================================
// Enforces the identity-anchor rule (422 with no anchor) counting nested phones/
// emails, normalizes each e164, and applies the primary invariant to the children.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/people', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = personBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Normalize + de-dupe the nested children ---
    // Each e164 is normalized; a bad one is a 400. Emails are lowercased at parse.
    // Within one create, a repeated e164/address collapses to one row (last wins),
    // so @@unique cannot trip on the request's own duplicates.
    const phoneByE164 = new Map<string, z.infer<typeof phoneInputSchema> & { e164: string }>()
    for (const p of body.phones ?? []) {
      const parsedPhone = parseE164(p.e164)
      if ('error' in parsedPhone) {
        return void res.status(400).json({ error: parsedPhone.error })
      }
      phoneByE164.set(parsedPhone.e164, { ...p, e164: parsedPhone.e164 })
    }
    const emailByAddress = new Map<string, z.infer<typeof emailInputSchema>>()
    for (const e of body.emails ?? []) {
      emailByAddress.set(e.address, e)
    }
    const phones = [...phoneByE164.values()]
    const emails = [...emailByAddress.values()]

    // --- Enforce the identity-anchor rule (spec §5.15) ---
    // 422, not 400: the body is well-formed, it just has no anchor.
    if (
      !hasAnchor({
        firstName: body.firstName,
        lastName: body.lastName,
        preferredFirstName: body.preferredFirstName,
        linkedinUrl: body.linkedinUrl,
        phoneCount: phones.length,
        emailCount: emails.length,
      })
    ) {
      return void res.status(422).json({ error: ANCHOR_ERROR })
    }

    // --- Verify the company is in this org ---
    if (body.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: body.companyId, orgId, deletedAt: null },
      })
      if (!company) {
        return void res.status(422).json({ error: 'The company was not found in this org.' })
      }
    }

    // --- Execute (one transaction: person + children + primary reconcile) ---
    const created = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          orgId,
          firstName: body.firstName,
          lastName: body.lastName,
          preferredFirstName: body.preferredFirstName,
          title: body.title,
          linkedinUrl: body.linkedinUrl,
          companyId: body.companyId,
          ownerUserId: body.ownerUserId,
          timeZone: body.timeZone,
          persona: body.persona,
          attentionStatus: body.attentionStatus ?? 'on_deck',
          attentionReason: body.attentionReason,
          callbackDate: body.callbackDate ? new Date(body.callbackDate) : undefined,
          source: body.source,
          nameAudioUrl: body.nameAudioUrl,
          ...(body.customJson ? { customJson: body.customJson as Prisma.InputJsonValue } : {}),
        },
      })

      for (const [position, p] of phones.entries()) {
        await tx.personPhone.create({
          data: {
            orgId,
            personId: person.id,
            e164: p.e164,
            extension: p.extension,
            label: p.label ?? 'other',
            status: p.status ?? 'unverified',
            reason: p.reason,
            isDnc: p.isDnc ?? false,
            dncReason: p.dncReason,
            lineType: p.lineType,
            source: p.source,
            isPrimary: p.isPrimary ?? false,
            position,
            bestTimeToCall: p.bestTimeToCall,
          },
        })
      }
      for (const e of emails) {
        await tx.personEmail.create({
          data: {
            orgId,
            personId: person.id,
            address: e.address,
            label: e.label ?? 'work',
            status: e.status ?? 'unverified',
            reason: e.reason,
            isDnc: e.isDnc ?? false,
            dncReason: e.dncReason,
            source: e.source,
            isPrimary: e.isPrimary ?? false,
          },
        })
      }

      // A caller-requested primary wins; otherwise the first value becomes primary.
      const preferPhone = phones.find((p) => p.isPrimary)?.e164
      const preferEmail = emails.find((e) => e.isPrimary)?.address
      const preferPhoneId = preferPhone
        ? (await tx.personPhone.findFirst({
            where: { personId: person.id, orgId, e164: preferPhone },
            select: { id: true },
          }))?.id
        : undefined
      const preferEmailId = preferEmail
        ? (await tx.personEmail.findFirst({
            where: { personId: person.id, orgId, address: preferEmail },
            select: { id: true },
          }))?.id
        : undefined
      await reconcilePhoneOrder(tx.personPhone as unknown as PhoneOrderDelegate, person.id, orgId, preferPhoneId)
      await reconcilePrimary(tx.personEmail as unknown as PrimaryDelegate, person.id, orgId, preferEmailId)

      const created = await tx.person.findFirstOrThrow({
        where: { id: person.id, orgId },
        include: { phones: true, addresses: true },
      })
      await recordActivityInTx(
        tx,
        activityFromRecordCreated(created, {
          kind: 'person',
          name: displayName(created, created.phones, created.addresses),
          links: { personId: created.id, companyId: created.companyId },
          actorUserId: userId,
        }),
      )
      return created
    })

    logger.info({ orgId, userId, personId: created.id }, 'created a person')
    void queueMailRematch({ orgId, recordType: 'person', recordId: created.id }).catch((error) => {
      logger.error({ orgId, personId: created.id, error }, 'could not queue mail rematch after person creation')
    })

    // --- Return response ---
    res.status(201).json({ person: mapPersonToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/people/:id — update a person's own fields
// ============================================================
// Re-checks the identity anchor against the MERGED result (name/linkedin plus the
// person's existing phone/email rows), so an update cannot strip the last anchor.
// Children are managed via the /phones and /emails sub-routes, not here.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/people/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = personBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    if ('phones' in raw || 'emails' in raw) {
      return void res
        .status(400)
        .json({ error: 'Manage phones and emails through the /phones and /emails routes.' })
    }

    // --- Load the current row (org-scoped), with child counts for the anchor ---
    const existing = await prisma.person.findFirst({
      where: { id, orgId, deletedAt: null },
      include: { _count: { select: { phones: true, addresses: true } } },
    })
    if (!existing) {
      return void res.status(404).json({ error: 'Person not found' })
    }

    // A field is cleared when the client sent the key blank/null; unchanged when
    // absent. This is what lets a PATCH both set and clear anchor fields.
    function resolve(
      key: 'firstName' | 'lastName' | 'preferredFirstName' | 'linkedinUrl',
    ): string | null | undefined {
      if (!(key in raw)) return undefined
      return blankToNull(raw[key]) as string | null
    }
    const nextFirst = resolve('firstName')
    const nextLast = resolve('lastName')
    const nextPreferred = resolve('preferredFirstName')
    const nextLinkedin = resolve('linkedinUrl')

    // --- Enforce the identity-anchor rule against the merged result ---
    const merged = {
      firstName: nextFirst === undefined ? existing.firstName : nextFirst,
      lastName: nextLast === undefined ? existing.lastName : nextLast,
      preferredFirstName: nextPreferred === undefined ? existing.preferredFirstName : nextPreferred,
      linkedinUrl: nextLinkedin === undefined ? existing.linkedinUrl : nextLinkedin,
      phoneCount: existing._count.phones,
      emailCount: existing._count.addresses,
    }
    if (!hasAnchor(merged)) {
      return void res.status(422).json({ error: ANCHOR_ERROR })
    }

    // --- Verify a new company is in this org ---
    if (body.companyId !== undefined) {
      const company = await prisma.company.findFirst({
        where: { id: body.companyId, orgId, deletedAt: null },
      })
      if (!company) {
        return void res.status(422).json({ error: 'The company was not found in this org.' })
      }
    }

    // --- Build the update, honoring "sent key" vs "absent key" ---
    const data: Record<string, unknown> = {}
    function textPatch(key: string): void {
      if (!(key in raw)) return
      data[key] = blankToNull(raw[key]) as string | null
    }
    for (const key of [
      'firstName',
      'lastName',
      'preferredFirstName',
      'title',
      'linkedinUrl',
      'companyId',
      'ownerUserId',
      'timeZone',
      'persona',
      'attentionReason',
      'source',
      'nameAudioUrl',
    ]) {
      textPatch(key)
    }
    if (body.attentionStatus !== undefined) data.attentionStatus = body.attentionStatus
    if ('callbackDate' in raw) {
      data.callbackDate = body.callbackDate ? new Date(body.callbackDate) : null
    }
    if (body.customJson !== undefined) data.customJson = body.customJson
    if (body.customValues !== undefined) {
      const custom = { ...((existing.customJson ?? {}) as Record<string, unknown>) }
      for (const [key, value] of Object.entries(body.customValues)) {
        if (value === null || value === '') delete custom[key]
        else custom[key] = value
      }
      data.customJson = custom
    }
    if (body.isArchived !== undefined) data.isArchived = body.isArchived

    // --- Execute query, with its field history in the SAME transaction ---
    // Spec §5.7 / MAI-136: a field change and its FieldHistory rows commit or roll
    // back together, so the two can never disagree. History is append-only and is
    // never the source of truth — the current value is still the plain column read
    // in the response below.
    const changedCount = await prisma.$transaction(async (tx) => {
      const result = await tx.person.updateMany({ where: { id, orgId, deletedAt: null }, data })
      if (result.count === 0) return 0

      const { customJson: nextCustom, ...columns } = data
      // Columns are PATCH-shaped: only the keys the caller sent are in `data`.
      const changes = diffFieldValues(existing as unknown as Record<string, unknown>, columns)
      if (nextCustom !== undefined) {
        // customJson is replaced wholesale by this route, so a key that vanished is a
        // cleared field — the `full` diff.
        changes.push(
          ...diffFieldValues(
            (existing.customJson ?? {}) as Record<string, unknown>,
            (nextCustom ?? {}) as Record<string, unknown>,
            { mode: 'full' },
          ),
        )
      }
      if (changes.length > 0) {
        await recordFieldHistoryInTx(tx, {
          orgId,
          objectSlug: 'person',
          recordId: id,
          changes,
          changeSource: 'user',
          changedByUserId: userId,
          attributes: await loadHistoryAttributes(tx, orgId, 'person'),
        })
      }
      return result.count
    })
    if (changedCount === 0) {
      return void res.status(404).json({ error: 'Person not found' })
    }

    logger.info({ orgId, userId, personId: id }, 'updated a person')

    // --- Return response ---
    const updated = await prisma.person.findFirst({
      where: { id, orgId },
      include: { phones: true, addresses: true },
    })
    if (!updated) {
      return void res.status(404).json({ error: 'Person not found' })
    }
    res.json({ person: mapPersonToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/people/:id — soft-delete into the trash
// ============================================================
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/people/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.person.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Person not found' })
    }

    logger.info({ orgId, userId, personId: id }, 'trashed a person')

    // --- Return response ---
    res.status(204).send()
  }),
)

// ============================================================
// Helper: load a live (non-trashed) person in this org, or answer 404.
// ============================================================
async function loadPersonOr404(
  res: import('express').Response,
  id: string,
  orgId: string,
): Promise<boolean> {
  const person = await prisma.person.findFirst({ where: { id, orgId, deletedAt: null } })
  if (!person) {
    res.status(404).json({ error: 'Person not found' })
    return false
  }
  return true
}

// ============================================================
// POST /api/orgs/:orgId/people/:id/phones — add (or idempotently re-add) a phone
// ============================================================
// Re-adding the same e164 merges into the existing row (idempotent under
// @@unique([personId, e164])) — a dead number is retained, not reset. The first
// phone auto-becomes primary; a requested primary demotes the others.
router.post(
  '/:id/phones',
  wrapRoute('POST /api/orgs/:orgId/people/:id/phones', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Parse & validate params ---
    const parsed = phoneInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const e164Result = parseE164(body.e164)
    if ('error' in e164Result) {
      return void res.status(400).json({ error: e164Result.error })
    }
    const e164 = e164Result.e164
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Execute (upsert + reconcile in one transaction) ---
    // On re-add, only the fields the caller SENT are written, so an existing dead
    // status/reason is preserved unless explicitly changed.
    const updateData: Prisma.PersonPhoneUpdateInput = {}
    if ('extension' in raw) updateData.extension = body.extension ?? null
    if (body.label !== undefined) updateData.label = body.label
    if (body.status !== undefined) updateData.status = body.status
    if ('reason' in raw) updateData.reason = body.reason ?? null
    if (body.isDnc !== undefined) updateData.isDnc = body.isDnc
    if ('dncReason' in raw) updateData.dncReason = body.dncReason ?? null
    if (body.lineType !== undefined) updateData.lineType = body.lineType
    if ('source' in raw) updateData.source = body.source ?? null
    if ('bestTimeToCall' in raw) updateData.bestTimeToCall = body.bestTimeToCall ?? null

    const phone = await prisma.$transaction(async (tx) => {
      const lastPhone = await tx.personPhone.findFirst({
        where: { personId, orgId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const upserted = await tx.personPhone.upsert({
        where: { personId_e164: { personId, e164 } },
        create: {
          orgId,
          personId,
          e164,
          extension: body.extension,
          label: body.label ?? 'other',
          status: body.status ?? 'unverified',
          reason: body.reason,
          isDnc: body.isDnc ?? false,
          dncReason: body.dncReason,
          lineType: body.lineType,
          source: body.source,
          isPrimary: false, // set by reconcile below, so the invariant is one code path
          position: (lastPhone?.position ?? -1) + 1,
          bestTimeToCall: body.bestTimeToCall,
        },
        update: updateData,
      })
      // Prefer this row for primary only when the caller explicitly asked.
      const preferId = body.isPrimary ? upserted.id : undefined
      await reconcilePhoneOrder(tx.personPhone as unknown as PhoneOrderDelegate, personId, orgId, preferId)
      return tx.personPhone.findFirstOrThrow({ where: { id: upserted.id, orgId } })
    })

    logger.info({ orgId, userId, personId, phoneId: phone.id }, 'added a person phone')

    // --- Return response ---
    res.status(201).json({ phone: mapPhoneToApi(phone) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/people/:id/phones/:phoneId — update one phone
// ============================================================
// Setting status to reachable clears the dead reason (a force-dial connect clears
// dead, §5.5). Setting isPrimary true promotes this row and demotes the rest;
// after any change the primary invariant is reconciled.
router.patch(
  '/:id/phones/:phoneId',
  wrapRoute('PATCH /api/orgs/:orgId/people/:id/phones/:phoneId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const phoneId = String(req.params.phoneId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Parse & validate params ---
    const patchSchema = phoneInputSchema.partial()
    const parsed = patchSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    const existing = await prisma.personPhone.findFirst({ where: { id: phoneId, personId, orgId } })
    if (!existing) {
      return void res.status(404).json({ error: 'Phone not found' })
    }

    // --- Build the update ---
    const data: Record<string, unknown> = {}
    if ('e164' in raw && body.e164) {
      const e164Result = parseE164(body.e164)
      if ('error' in e164Result) {
        return void res.status(400).json({ error: e164Result.error })
      }
      data.e164 = e164Result.e164
    }
    if ('extension' in raw) data.extension = body.extension ?? null
    if (body.label !== undefined) data.label = body.label
    if (body.status !== undefined) {
      data.status = body.status
      // reachable means it works now, so a stale dead reason is cleared.
      if (body.status === 'reachable' && !('reason' in raw)) data.reason = null
    }
    if ('reason' in raw) data.reason = body.reason ?? null
    if (body.isDnc !== undefined) data.isDnc = body.isDnc
    if ('dncReason' in raw) data.dncReason = body.dncReason ?? null
    if (body.lineType !== undefined) data.lineType = body.lineType
    if ('source' in raw) data.source = body.source ?? null
    if ('bestTimeToCall' in raw) data.bestTimeToCall = body.bestTimeToCall ?? null
    if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary

    // --- Execute (update + reconcile) ---
    const phone = await prisma.$transaction(async (tx) => {
      try {
        await tx.personPhone.updateMany({ where: { id: phoneId, personId, orgId }, data })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw Object.assign(new Error('DUPLICATE_E164'), { httpDuplicate: true })
        }
        throw error
      }
      // If the caller set this row primary, prefer it; if they set it false while
      // it was the only primary, reconcile still guarantees one primary remains.
      const preferId = body.isPrimary === true ? phoneId : undefined
      await reconcilePhoneOrder(tx.personPhone as unknown as PhoneOrderDelegate, personId, orgId, preferId)
      return tx.personPhone.findFirstOrThrow({ where: { id: phoneId, orgId } })
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'httpDuplicate' in error) {
        res.status(409).json({ error: 'That number already exists on this person.' })
        return null
      }
      throw error
    })
    if (!phone) return

    logger.info({ orgId, userId, personId, phoneId }, 'updated a person phone')

    // --- Return response ---
    res.json({ phone: mapPhoneToApi(phone) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/people/:id/phones/:phoneId — remove one phone
// ============================================================
// A real delete (unlike a dead value, which is retained): the number is gone, not
// dead. If it was the primary and others remain, one is auto-promoted (§5.11).
router.delete(
  '/:id/phones/:phoneId',
  wrapRoute('DELETE /api/orgs/:orgId/people/:id/phones/:phoneId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const phoneId = String(req.params.phoneId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Execute (delete + reconcile) ---
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.personPhone.deleteMany({ where: { id: phoneId, personId, orgId } })
      if (result.count === 0) return false
      // The deleted row may have been the primary; promote the oldest remaining.
      await reconcilePhoneOrder(tx.personPhone as unknown as PhoneOrderDelegate, personId, orgId)
      return true
    })
    if (!deleted) {
      return void res.status(404).json({ error: 'Phone not found' })
    }

    logger.info({ orgId, userId, personId, phoneId }, 'removed a person phone')

    // --- Return response ---
    res.status(204).send()
  }),
)

// ============================================================
// POST /api/orgs/:orgId/people/:id/emails — add (or idempotently re-add) an email
// ============================================================
router.post(
  '/:id/emails',
  wrapRoute('POST /api/orgs/:orgId/people/:id/emails', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Parse & validate params ---
    const parsed = emailInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    const updateData: Prisma.PersonEmailUpdateInput = {}
    if (body.label !== undefined) updateData.label = body.label
    if (body.status !== undefined) updateData.status = body.status
    if ('reason' in raw) updateData.reason = body.reason ?? null
    if (body.isDnc !== undefined) updateData.isDnc = body.isDnc
    if ('dncReason' in raw) updateData.dncReason = body.dncReason ?? null
    if ('source' in raw) updateData.source = body.source ?? null

    // --- Execute (upsert + reconcile) ---
    const email = await prisma.$transaction(async (tx) => {
      const upserted = await tx.personEmail.upsert({
        where: { personId_address: { personId, address: body.address } },
        create: {
          orgId,
          personId,
          address: body.address,
          label: body.label ?? 'work',
          status: body.status ?? 'unverified',
          reason: body.reason,
          isDnc: body.isDnc ?? false,
          dncReason: body.dncReason,
          source: body.source,
          isPrimary: false,
        },
        update: updateData,
      })
      const preferId = body.isPrimary ? upserted.id : undefined
      await reconcilePrimary(tx.personEmail as unknown as PrimaryDelegate, personId, orgId, preferId)
      return tx.personEmail.findFirstOrThrow({ where: { id: upserted.id, orgId } })
    })

    logger.info({ orgId, userId, personId, emailId: email.id }, 'added a person email')

    // --- Return response ---
    res.status(201).json({ email: mapEmailToApi(email) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/people/:id/emails/:emailId — update one email
// ============================================================
router.patch(
  '/:id/emails/:emailId',
  wrapRoute('PATCH /api/orgs/:orgId/people/:id/emails/:emailId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const emailId = String(req.params.emailId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Parse & validate params ---
    const parsed = emailInputSchema.partial().safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    const existing = await prisma.personEmail.findFirst({ where: { id: emailId, personId, orgId } })
    if (!existing) {
      return void res.status(404).json({ error: 'Email not found' })
    }

    const data: Record<string, unknown> = {}
    if ('address' in raw && body.address) data.address = body.address
    if (body.label !== undefined) data.label = body.label
    if (body.status !== undefined) {
      data.status = body.status
      if (body.status === 'reachable' && !('reason' in raw)) data.reason = null
    }
    if ('reason' in raw) data.reason = body.reason ?? null
    if (body.isDnc !== undefined) data.isDnc = body.isDnc
    if ('dncReason' in raw) data.dncReason = body.dncReason ?? null
    if ('source' in raw) data.source = body.source ?? null
    if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary

    // --- Execute (update + reconcile) ---
    const email = await prisma.$transaction(async (tx) => {
      try {
        await tx.personEmail.updateMany({ where: { id: emailId, personId, orgId }, data })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw Object.assign(new Error('DUPLICATE_ADDRESS'), { httpDuplicate: true })
        }
        throw error
      }
      const preferId = body.isPrimary === true ? emailId : undefined
      await reconcilePrimary(tx.personEmail as unknown as PrimaryDelegate, personId, orgId, preferId)
      return tx.personEmail.findFirstOrThrow({ where: { id: emailId, orgId } })
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'httpDuplicate' in error) {
        res.status(409).json({ error: 'That address already exists on this person.' })
        return null
      }
      throw error
    })
    if (!email) return

    logger.info({ orgId, userId, personId, emailId }, 'updated a person email')

    // --- Return response ---
    res.json({ email: mapEmailToApi(email) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/people/:id/emails/:emailId — remove one email
// ============================================================
router.delete(
  '/:id/emails/:emailId',
  wrapRoute('DELETE /api/orgs/:orgId/people/:id/emails/:emailId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const personId = String(req.params.id)
    const emailId = String(req.params.emailId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadPersonOr404(res, personId, orgId))) return

    // --- Execute (delete + reconcile) ---
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.personEmail.deleteMany({ where: { id: emailId, personId, orgId } })
      if (result.count === 0) return false
      await reconcilePrimary(tx.personEmail as unknown as PrimaryDelegate, personId, orgId)
      return true
    })
    if (!deleted) {
      return void res.status(404).json({ error: 'Email not found' })
    }

    logger.info({ orgId, userId, personId, emailId }, 'removed a person email')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
