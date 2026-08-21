/**
 * Company routes — the CRM's identity anchor for an account (MAI-129, T1).
 *
 * Mounted at /api/orgs/:orgId/companies. The org lives in the path, not in the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches. Every route below requires authentication and an active
 * membership in the org named by the path.
 *
 * Two rules the database CANNOT enforce, so they live here (spec §5.11, §5.15):
 *   1. Identity anchor — a company needs at least one of name | domain |
 *      linkedinUrl. All three are nullable columns, and "at least one is
 *      non-null" is not a constraint Prisma can express.
 *   2. Empty → absent — a cleared value is stored as NULL/omitted, never "".
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
import type { Company, Prisma } from '../generated/prisma/client.js'

// mergeParams so :orgId from the mount path reaches req.params here — without it
// the tenant filter would silently read undefined.
const router = Router({ mergeParams: true })

// The attentionStatus values the app's own code branches on (spec §5.6a). A fixed
// system enum: a plain String column plus this TS union, never a Prisma enum.
const ATTENTION_STATUSES = ['on_deck', 'on_hold', 'backburner', 'disqualified'] as const

// --- Mapper: database row → API shape ---

// orgId is deliberately absent: the caller already knows it (it is the path).
// mergedIntoId / deletedById are internal bookkeeping and not exposed. displayName
// is computed here so every client renders the same fallback (spec §5.15).
function mapCompanyToApi(company: Company) {
  return {
    id: company.id,
    name: company.name,
    legalName: company.legalName,
    displayName: company.name ?? company.domain ?? 'Untitled company',
    companyType: company.companyType,
    domain: company.domain,
    alternateDomains: company.alternateDomains,
    linkedinUrl: company.linkedinUrl,
    industry: company.industry,
    sizeEmployees: company.sizeEmployees,
    logoUrl: company.logoUrl,
    parentCompanyId: company.parentCompanyId,
    ownerUserId: company.ownerUserId,
    attentionStatus: company.attentionStatus,
    attentionReason: company.attentionReason,
    callbackDate: company.callbackDate ? company.callbackDate.toISOString() : null,
    source: company.source,
    customJson: company.customJson,
    isArchived: company.isArchived,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
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
// clears a field: "" / null both mean "store NULL", while an absent key means
// "leave unchanged" (handled by the field being optional in the schema).
function blankToNull(value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// An optional, trimmed, empty-to-absent string field.
const optionalText = z.preprocess(blankToUndefined, z.string().optional())

// The writable body shared by create and update. Everything is optional; the
// identity-anchor rule is checked after parsing, against the merged result, not
// by zod (it spans three fields and, on update, the stored row).
const companyBodySchema = z.object({
  name: optionalText,
  legalName: optionalText,
  companyType: optionalText,
  domain: z.preprocess(
    blankToUndefined,
    z
      .string()
      // A bare hostname: labels of letters/digits/hyphens joined by dots, with a
      // TLD. No scheme, no path — enrichment and dedupe key on the host alone.
      .regex(
        /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i,
        'Enter a bare domain like example.com — no https:// and no path.',
      )
      .optional(),
  ),
  alternateDomains: z.array(z.string().trim().min(1)).optional(),
  linkedinUrl: optionalText,
  industry: optionalText,
  sizeEmployees: z.number().int().min(0, 'Employee count cannot be negative.').optional(),
  logoUrl: optionalText,
  parentCompanyId: z.preprocess(blankToUndefined, z.string().optional()),
  ownerUserId: z.preprocess(blankToUndefined, z.string().optional()),
  attentionStatus: z
    .enum(ATTENTION_STATUSES, {
      error: `attentionStatus is one of: ${ATTENTION_STATUSES.join(', ')}.`,
    })
    .optional(),
  attentionReason: optionalText,
  callbackDate: z.preprocess(
    blankToUndefined,
    z.iso.datetime({ error: 'callbackDate must be an ISO-8601 timestamp.' }).optional(),
  ),
  source: optionalText,
  customJson: z.record(z.string(), z.unknown()).optional(),
})

const ANCHOR_ERROR =
  'A company needs at least one of a name, a domain, or a LinkedIn URL.'

const DUPLICATE_DOMAIN_ERROR = 'A company with this domain already exists in this org.'

// True when a merged row would have at least one identity anchor (spec §5.15).
function hasAnchor(fields: {
  name?: string | null
  domain?: string | null
  linkedinUrl?: string | null
}): boolean {
  return Boolean(fields.name || fields.domain || fields.linkedinUrl)
}

// Prisma's unique-constraint violation. Duck-typed rather than instanceof so the
// route does not depend on which error class the generated client exports.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

// --- List input ---

export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100

// The columns a list may sort on. Each token is the Prisma field name it orders
// by, and the enum is the allow-list that stops an arbitrary column reaching the
// query.
const SORT_FIELDS = ['createdAt', 'name', 'domain'] as const

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
  // Free-text match against name and domain; blank means no filter.
  q: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(1).optional(),
  ),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/companies — the org's companies
// ============================================================
// Paginated, sortable, searchable by name/domain. Trashed rows (deletedAt set)
// are excluded; the count and the page read against the SAME where clause so
// `total` and the rows can never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/companies', async (req, res) => {
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
    const { page, limit, sort, dir, q } = parsed.data

    // --- Build filters ---
    // orgId is the tenant boundary, always; deletedAt: null hides the trash.
    const where = {
      orgId,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { domain: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    const orderBy =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: dir }, { createdAt: 'desc' as const }]
    const [total, companies] = await Promise.all([
      prisma.company.count({ where }),
      prisma.company.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    ])

    // --- Return response ---
    res.json({ companies: companies.map(mapCompanyToApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/companies/:id — one company
// ============================================================
// id AND orgId together, never id alone: a real id in another org matches nothing
// and falls to the 404, so this route never confirms a row it must not reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/companies/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const company = await prisma.company.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!company) {
      return void res.status(404).json({ error: 'Company not found' })
    }

    // --- Return response ---
    res.json({ company: mapCompanyToApi(company) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/companies — create a company
// ============================================================
// Enforces the identity-anchor rule (422 with no anchor) and org-scoped domain
// uniqueness (409 on a duplicate). orgId comes from the path, never the body.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/companies', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = companyBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Enforce the identity-anchor rule (spec §5.15) ---
    // 422, not 400: the body is well-formed, it just has no anchor to hang an
    // identity on.
    if (!hasAnchor(body)) {
      return void res.status(422).json({ error: ANCHOR_ERROR })
    }

    // --- Verify the parent is in this org ---
    // A parent in another org would be a cross-tenant link, so it is checked
    // against id+orgId and rejected as "not found" rather than leaked.
    if (body.parentCompanyId) {
      const parent = await prisma.company.findFirst({
        where: { id: body.parentCompanyId, orgId, deletedAt: null },
      })
      if (!parent) {
        return void res.status(422).json({ error: 'The parent company was not found in this org.' })
      }
    }

    // --- Execute query ---
    // orgId comes from the path, never the body. Optional fields left undefined
    // fall to the schema defaults / NULL — empty strings were already normalized
    // to undefined at parse time.
    const data: Prisma.CompanyUncheckedCreateInput = {
      orgId,
      name: body.name,
      legalName: body.legalName,
      companyType: body.companyType,
      domain: body.domain,
      alternateDomains: body.alternateDomains ?? [],
      linkedinUrl: body.linkedinUrl,
      industry: body.industry,
      sizeEmployees: body.sizeEmployees,
      logoUrl: body.logoUrl,
      parentCompanyId: body.parentCompanyId,
      ownerUserId: body.ownerUserId,
      attentionStatus: body.attentionStatus ?? 'on_deck',
      attentionReason: body.attentionReason,
      callbackDate: body.callbackDate ? new Date(body.callbackDate) : undefined,
      source: body.source,
      ...(body.customJson ? { customJson: body.customJson as Prisma.InputJsonValue } : {}),
    }
    let created: Company
    try {
      created = await prisma.company.create({ data })
    } catch (error) {
      // A race-safe duplicate check: the @@unique([orgId, domain]) index is the
      // single source of truth, so two concurrent creates cannot both win.
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: DUPLICATE_DOMAIN_ERROR })
      }
      throw error
    }

    logger.info({ orgId, userId, companyId: created.id }, 'created a company')

    // --- Return response ---
    res.status(201).json({ company: mapCompanyToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/companies/:id — update a company
// ============================================================
// Re-checks the identity anchor against the MERGED result, so an update cannot
// strip a company of its last anchor. Clears go to NULL (empty → absent).
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/companies/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = companyBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.company.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Company not found' })
    }

    // A field is being cleared when the client sent the key with an empty/null
    // value; it is left unchanged when the key is absent. This is what lets a
    // PATCH both set and clear anchors, which the merged-anchor check below reads.
    function resolve(key: 'name' | 'domain' | 'linkedinUrl'): string | null | undefined {
      if (!(key in raw)) return undefined // absent → unchanged
      return blankToNull(raw[key]) as string | null
    }
    const nextName = resolve('name')
    const nextDomain = resolve('domain')
    const nextLinkedin = resolve('linkedinUrl')

    // --- Enforce the identity-anchor rule against the merged result ---
    const merged = {
      name: nextName === undefined ? existing.name : nextName,
      domain: nextDomain === undefined ? existing.domain : nextDomain,
      linkedinUrl: nextLinkedin === undefined ? existing.linkedinUrl : nextLinkedin,
    }
    if (!hasAnchor(merged)) {
      return void res.status(422).json({ error: ANCHOR_ERROR })
    }

    // --- Verify a new parent is in-org and not the row itself ---
    if (body.parentCompanyId !== undefined) {
      if (body.parentCompanyId === id) {
        return void res.status(422).json({ error: 'A company cannot be its own parent.' })
      }
      const parent = await prisma.company.findFirst({
        where: { id: body.parentCompanyId, orgId, deletedAt: null },
      })
      if (!parent) {
        return void res.status(422).json({ error: 'The parent company was not found in this org.' })
      }
    }

    // --- Build the update, honoring "sent key" vs "absent key" ---
    // For each field: present in the raw body → written (cleared to NULL when
    // blank); absent → omitted so Prisma leaves it untouched.
    function textPatch(key: string): { value: string | null } | undefined {
      if (!(key in raw)) return undefined
      return { value: blankToNull(raw[key]) as string | null }
    }
    const data: Record<string, unknown> = {}
    for (const key of [
      'name',
      'legalName',
      'companyType',
      'domain',
      'linkedinUrl',
      'industry',
      'logoUrl',
      'attentionReason',
      'source',
      'ownerUserId',
      'parentCompanyId',
    ]) {
      const patch = textPatch(key)
      if (patch) data[key] = patch.value
    }
    if ('alternateDomains' in raw && body.alternateDomains) data.alternateDomains = body.alternateDomains
    if ('sizeEmployees' in raw) data.sizeEmployees = body.sizeEmployees ?? null
    if (body.attentionStatus !== undefined) data.attentionStatus = body.attentionStatus
    if ('callbackDate' in raw) {
      data.callbackDate = body.callbackDate ? new Date(body.callbackDate) : null
    }
    if (body.customJson !== undefined) data.customJson = body.customJson

    // --- Execute query ---
    // updateMany with id+orgId, never update-by-id: the tenant key carries the
    // boundary. count === 0 means it vanished between the read and here.
    let count: number
    try {
      const result = await prisma.company.updateMany({ where: { id, orgId, deletedAt: null }, data })
      count = result.count
    } catch (error) {
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: DUPLICATE_DOMAIN_ERROR })
      }
      throw error
    }
    if (count === 0) {
      return void res.status(404).json({ error: 'Company not found' })
    }

    logger.info({ orgId, userId, companyId: id }, 'updated a company')

    // --- Return response ---
    // Re-read so the response carries the stored row, not a hand-patched copy.
    const updated = await prisma.company.findFirst({ where: { id, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Company not found' })
    }
    res.json({ company: mapCompanyToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/companies/:id — soft-delete into the trash
// ============================================================
// Sets deletedAt (and deletedById) rather than removing the row: deletes land in
// a 30-day trash an hourly sweep clears later (spec §5.10). Scoped to id+orgId,
// so a row in another org is 404, never confirmed.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/companies/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // Compare-and-set on deletedAt: null, scoped by orgId, so a second delete of
    // the same already-trashed row finds count 0 and answers 404.
    const result = await prisma.company.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Company not found' })
    }

    logger.info({ orgId, userId, companyId: id }, 'trashed a company')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
