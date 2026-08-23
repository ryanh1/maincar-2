/**
 * Deal routes — one possible sale: pipeline, forecast, and the reason to call
 * (MAI-131, T3). Plus DealPersonRole, the buying committee (multi-threading).
 *
 * Mounted at /api/orgs/:orgId/deals. The org lives in the path, not in the
 * caller's `currentOrgId`: filtering on a UI preference would let a stale choice
 * decide which tenant's rows a request touches. Every route requires auth and an
 * active membership in the org named by the path.
 *
 * Two rules the database CANNOT enforce, so they live here (spec §5.4, §5.8):
 *   1. A Deal's stage must belong to the Deal's pipeline. stageId and pipelineId
 *      are each a valid FK on their own, but "this stage is in that pipeline" is a
 *      cross-row relationship no single foreign key can state. Checked on create,
 *      and against the MERGED (pipelineId, stageId) pair on update.
 *   2. Money is integer minor units (BigInt), never a float (§5.8). The route
 *      accepts amountMinor as an exact integer (number or digit string) and
 *      RETURNS it as a string, so a value round-trips with no float drift. A
 *      fractional input (a dollars-and-cents float) is a 400, not a silent round.
 *
 * The @@unique([dealId, personId]) on DealPersonRole means a person appears at
 * most once per deal, and re-adding them is idempotent (it updates their role).
 * The SAME person can still hold DIFFERENT roles on DIFFERENT deals.
 *
 * The tenant boundary is the orgId filter on every read AND write: single-record
 * reads go through findFirst({ where: { id, orgId } }) and writes through
 * updateMany/deleteMany({ where: { id, orgId } }), never by id alone
 * (.claude/rules/database-and-prisma.md).
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { activityFromRecordCreated, activityFromStageChange, recordActivityInTx } from '../crm/activityFeed.js'
import { recordFieldHistoryInTx } from '../crm/fieldHistory.js'
import type { Deal, DealPersonRole, Prisma } from '../generated/prisma/client.js'

// mergeParams so :orgId from the mount path reaches req.params here — without it
// the tenant filter would silently read undefined.
const router = Router({ mergeParams: true })

// --- Fixed system enums (spec §5.6a): plain String columns + a TS union here,
// never a Prisma enum. App code branches on these; the user cannot add values. ---
const DEAL_STATUSES = ['open', 'won', 'lost'] as const
const DEAL_ROLES = [
  'champion',
  'decision_maker',
  'economic_buyer',
  'influencer',
  'blocker',
  'user',
  'other',
] as const

// --- Mappers: database row → API shape ---
// orgId is deliberately absent — the caller already knows it (it is the path).
// mergedIntoId / deletedById are internal bookkeeping and not exposed.

// amountMinor is a BigInt in the DB; JSON has no BigInt, so it is emitted as an
// exact integer STRING (or null). A client re-sends that same string, so the
// value round-trips with no float drift (spec §5.8).
function mapDealToApi(
  deal: Deal & { personRoles?: Array<DealPersonRole & { person?: { id: string; firstName: string | null; lastName: string | null; isArchived: boolean } }> },
) {
  return {
    id: deal.id,
    name: deal.name,
    companyId: deal.companyId,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    amountMinor: deal.amountMinor === null ? null : deal.amountMinor.toString(),
    currency: deal.currency,
    closeDate: deal.closeDate ? deal.closeDate.toISOString() : null,
    status: deal.status,
    lostReason: deal.lostReason,
    ownerUserId: deal.ownerUserId,
    customJson: deal.customJson,
    isArchived: deal.isArchived,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    ...(deal.personRoles ? { personRoles: deal.personRoles.map(mapRoleToApi) } : {}),
  }
}

function mapRoleToApi(role: DealPersonRole & { person?: { id: string; firstName: string | null; lastName: string | null; isArchived: boolean } }) {
  return {
    id: role.id,
    dealId: role.dealId,
    personId: role.personId,
    role: role.role,
    isPrimary: role.isPrimary,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
    ...(role.person ? {
      person: {
        id: role.person.id,
        firstName: role.person.firstName,
        lastName: role.person.lastName,
        isArchived: role.person.isArchived,
      },
    } : {}),
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

const optionalText = z.preprocess(blankToUndefined, z.string().optional())

// amountMinor accepts an integer (number) OR a digit string, and rejects a float:
// "minor units, never a float" means 12.50 dollars is sent as 1250, not 12.5. A
// fractional value (or non-numeric string) fails the refine and is a 400 with a
// message that names the rule (a bare union would only say "Invalid input").
const AMOUNT_MINOR_ERROR =
  'amountMinor must be a whole number of minor units (cents), never a float.'
const amountMinorSchema = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z
    .union([z.number(), z.string()])
    .optional()
    .refine(
      (v) =>
        v === undefined ||
        (typeof v === 'number' ? Number.isInteger(v) : /^-?\d+$/.test(v)),
      { error: AMOUNT_MINOR_ERROR },
    ),
)

// ISO-4217: three uppercase letters. Lowercased input is upper-cased first.
const currencySchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
  z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO-4217 code, like USD.').optional(),
)

// ============================================================
// Zod bodies
// ============================================================

// The writable Deal body shared by create and update. pipelineId/stageId are
// required on create (enforced below), optional on update; the stage-in-pipeline
// rule is checked after parsing, against the merged result.
const dealBodySchema = z.object({
  name: optionalText,
  companyId: z.preprocess(blankToUndefined, z.string().optional()),
  pipelineId: z.preprocess(blankToUndefined, z.string().optional()),
  stageId: z.preprocess(blankToUndefined, z.string().optional()),
  amountMinor: amountMinorSchema,
  currency: currencySchema,
  closeDate: z.preprocess(
    blankToUndefined,
    z.iso.datetime({ error: 'closeDate must be an ISO-8601 timestamp.' }).optional(),
  ),
  status: z.enum(DEAL_STATUSES, { error: `status is one of: ${DEAL_STATUSES.join(', ')}.` }).optional(),
  lostReason: optionalText,
  ownerUserId: z.preprocess(blankToUndefined, z.string().optional()),
  customJson: z.record(z.string(), z.unknown()).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  isArchived: z.boolean().optional(),
})

const roleInputSchema = z.object({
  personId: z.string({ error: 'A role needs a personId.' }).trim().min(1, 'A role needs a personId.'),
  role: z.enum(DEAL_ROLES, { error: `role is one of: ${DEAL_ROLES.join(', ')}.` }),
  isPrimary: z.boolean().optional(),
})

// A BigInt from the validated amountMinor value (number or digit string).
function toAmountMinor(value: number | string): bigint {
  return BigInt(value)
}

// ============================================================
// Stage-in-pipeline rule (spec §5.4) — the DB cannot express it
// ============================================================
// A deal's stage must be a stage OF its pipeline. Returns an error message when
// the pair is invalid, or null when it is good. Both rows are checked org-scoped,
// so a pipeline/stage in another org reads as "not found" and never leaks.
async function validateStageInPipeline(
  orgId: string,
  pipelineId: string,
  stageId: string,
): Promise<string | null> {
  const [pipeline, stage] = await Promise.all([
    prisma.pipeline.findFirst({ where: { id: pipelineId, orgId }, select: { id: true } }),
    prisma.pipelineStage.findFirst({
      where: { id: stageId, orgId },
      select: { id: true, pipelineId: true },
    }),
  ])
  if (!pipeline) return 'The pipeline was not found in this org.'
  if (!stage) return 'The stage was not found in this org.'
  if (stage.pipelineId !== pipelineId) return 'The stage does not belong to that pipeline.'
  return null
}

// --- List input ---

export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100

const SORT_FIELDS = ['createdAt', 'name', 'closeDate'] as const

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z.enum(SORT_FIELDS, { error: `Sort by one of: ${SORT_FIELDS.join(', ')}.` }).default('createdAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),
  q: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(1).optional(),
  ),
  companyId: z.preprocess(blankToUndefined, z.string().optional()),
  stageId: z.preprocess(blankToUndefined, z.string().optional()),
  status: z.enum(DEAL_STATUSES, { error: `status is one of: ${DEAL_STATUSES.join(', ')}.` }).optional(),
  includeArchived: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean().optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/deals — the org's deals
// ============================================================
// Paginated, sortable, searchable by name; filterable by company/stage/status.
// Trashed rows (deletedAt set) are excluded; the count and the page read against
// the SAME where clause so `total` and the rows can never describe different sets.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/deals', async (req, res) => {
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
    const { page, limit, sort, dir, q, companyId, stageId, status, includeArchived } = parsed.data

    // --- Build filters ---
    const where: Prisma.DealWhereInput = {
      orgId,
      deletedAt: null,
      ...(includeArchived ? {} : { isArchived: false }),
      ...(companyId ? { companyId } : {}),
      ...(stageId ? { stageId } : {}),
      ...(status ? { status } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    }

    // --- Execute query ---
    const orderBy =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: dir }, { createdAt: 'desc' as const }]
    const [total, deals] = await Promise.all([
      prisma.deal.count({ where }),
      prisma.deal.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    ])

    // --- Return response ---
    res.json({ deals: deals.map(mapDealToApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/deals/:id — one deal, with its person-roles
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/deals/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const deal = await prisma.deal.findFirst({
      where: { id, orgId, deletedAt: null },
      include: { personRoles: { include: { person: true } } },
    })
    if (!deal) {
      return void res.status(404).json({ error: 'Deal not found' })
    }

    // --- Return response ---
    res.json({ deal: mapDealToApi(deal) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/deals — create a deal
// ============================================================
// A deal needs a name, a pipeline, and a stage that BELONGS to that pipeline
// (spec §5.4). A company, when named, must be in this org. orgId comes from the
// path, never the body.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/deals', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = dealBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    if (!body.name) {
      return void res.status(422).json({ error: 'A deal needs a name.' })
    }
    if (!body.pipelineId || !body.stageId) {
      return void res.status(422).json({ error: 'A deal needs a pipeline and a stage.' })
    }

    // --- Verify the stage belongs to the pipeline (spec §5.4) ---
    const stageError = await validateStageInPipeline(orgId, body.pipelineId, body.stageId)
    if (stageError) {
      return void res.status(422).json({ error: stageError })
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

    // --- Execute query ---
    const data: Prisma.DealUncheckedCreateInput = {
      orgId,
      name: body.name,
      companyId: body.companyId,
      pipelineId: body.pipelineId,
      stageId: body.stageId,
      amountMinor: body.amountMinor !== undefined ? toAmountMinor(body.amountMinor) : undefined,
      currency: body.currency ?? 'USD',
      closeDate: body.closeDate ? new Date(body.closeDate) : undefined,
      status: body.status ?? 'open',
      lostReason: body.lostReason,
      ownerUserId: body.ownerUserId,
      ...(body.customJson ? { customJson: body.customJson as Prisma.InputJsonValue } : {}),
    }
    const created = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({ data })
      await recordActivityInTx(
        tx,
        activityFromRecordCreated(deal, {
          kind: 'deal',
          name: deal.name,
          links: { companyId: deal.companyId, dealId: deal.id },
          actorUserId: userId,
        }),
      )
      return deal
    })

    logger.info({ orgId, userId, dealId: created.id }, 'created a deal')

    // --- Return response ---
    res.status(201).json({ deal: mapDealToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/deals/:id — update a deal
// ============================================================
// If the pipeline and/or stage change, the MERGED pair is re-validated so a deal
// can never end up on a stage outside its pipeline (spec §5.4). Clears go to NULL.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/deals/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = dealBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.deal.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Deal not found' })
    }

    // --- Re-validate the stage-in-pipeline rule against the merged pair ---
    // Name and pipeline/stage are anchors of a deal: a PATCH may not clear them.
    if ('name' in raw && !body.name) {
      return void res.status(422).json({ error: 'A deal needs a name.' })
    }
    if (('pipelineId' in raw && !body.pipelineId) || ('stageId' in raw && !body.stageId)) {
      return void res.status(422).json({ error: 'A deal needs a pipeline and a stage.' })
    }
    if ('pipelineId' in raw || 'stageId' in raw) {
      const nextPipelineId = body.pipelineId ?? existing.pipelineId
      const nextStageId = body.stageId ?? existing.stageId
      const stageError = await validateStageInPipeline(orgId, nextPipelineId, nextStageId)
      if (stageError) {
        return void res.status(422).json({ error: stageError })
      }
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
    if ('name' in raw && body.name) data.name = body.name
    if (body.pipelineId !== undefined) data.pipelineId = body.pipelineId
    if (body.stageId !== undefined) data.stageId = body.stageId
    if ('companyId' in raw) data.companyId = blankToNull(raw.companyId) as string | null
    if ('ownerUserId' in raw) data.ownerUserId = blankToNull(raw.ownerUserId) as string | null
    if ('lostReason' in raw) data.lostReason = body.lostReason ?? null
    if (body.status !== undefined) data.status = body.status
    if (body.currency !== undefined) data.currency = body.currency
    if ('amountMinor' in raw) {
      data.amountMinor = body.amountMinor !== undefined ? toAmountMinor(body.amountMinor) : null
    }
    if ('closeDate' in raw) {
      data.closeDate = body.closeDate ? new Date(body.closeDate) : null
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

    // --- Execute query ---
    // A stage move is both a Deal update and a timeline event. Keep them in one
    // transaction so a row cannot claim a move that did not commit, nor can a
    // committed move disappear from the account history.
    const stageChanged = body.stageId !== undefined && body.stageId !== existing.stageId
    const changedAt = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.deal.updateMany({ where: { id, orgId, deletedAt: null }, data })
      if (updated.count === 0 || !stageChanged) return updated

      // Reporting's stage-entry rows read FieldHistory, while the deal and its
      // activity feed keep their own purposes. Writing all three in this one
      // transaction makes a committed move visible to every consumer together.
      await recordFieldHistoryInTx(tx, {
        orgId,
        objectSlug: 'deal',
        recordId: existing.id,
        changes: [{ attribute: 'stageId', oldValue: existing.stageId, newValue: body.stageId }],
        changedByUserId: userId,
      })

      // Both names are captured at write time: the timeline and deal ribbon read
      // the durable before/after snapshot without joining PipelineStage later.
      const [beforeStage, afterStage] = await Promise.all([
        tx.pipelineStage.findFirst({ where: { id: existing.stageId, orgId }, select: { name: true } }),
        tx.pipelineStage.findFirst({ where: { id: body.stageId, orgId }, select: { name: true } }),
      ])
      if (!beforeStage || !afterStage) throw new Error('A deal stage vanished while recording its move.')

      await recordActivityInTx(
        tx,
        activityFromStageChange(
          { ...existing, updatedAt: changedAt },
          {
            // This one transition is immutable. A retry that replays this exact
            // write uses the same source identity while a later move gets its
            // own timeline row rather than overwriting account history.
            sourceId: `${existing.id}:${existing.stageId}:${body.stageId}:${existing.updatedAt.toISOString()}`,
            before: beforeStage.name,
            after: afterStage.name,
            createdByUserId: userId,
          },
        ),
      )
      return updated
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Deal not found' })
    }

    logger.info({ orgId, userId, dealId: id }, 'updated a deal')

    // --- Return response ---
    const updated = await prisma.deal.findFirst({
      where: { id, orgId },
      include: { personRoles: { include: { person: true } } },
    })
    if (!updated) {
      return void res.status(404).json({ error: 'Deal not found' })
    }
    res.json({ deal: mapDealToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/deals/:id — soft-delete into the trash
// ============================================================
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/deals/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.deal.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Deal not found' })
    }

    logger.info({ orgId, userId, dealId: id }, 'trashed a deal')

    // --- Return response ---
    res.status(204).send()
  }),
)

// ============================================================
// Helper: load a live (non-trashed) deal in this org, or answer 404.
// ============================================================
async function loadDealOr404(
  res: import('express').Response,
  id: string,
  orgId: string,
): Promise<boolean> {
  const deal = await prisma.deal.findFirst({ where: { id, orgId, deletedAt: null } })
  if (!deal) {
    res.status(404).json({ error: 'Deal not found' })
    return false
  }
  return true
}

// ============================================================
// POST /api/orgs/:orgId/deals/:id/roles — add (or idempotently update) a role
// ============================================================
// Attaches a person to this deal's buying committee. Re-adding the same person
// updates their role/isPrimary (idempotent under @@unique([dealId, personId]))
// rather than erroring — the same person can still hold a DIFFERENT role on a
// DIFFERENT deal, which this unique key does not touch.
router.post(
  '/:id/roles',
  wrapRoute('POST /api/orgs/:orgId/deals/:id/roles', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const dealId = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadDealOr404(res, dealId, orgId))) return

    // --- Parse & validate params ---
    const parsed = roleInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Verify the person is in this org ---
    const person = await prisma.person.findFirst({
      where: { id: body.personId, orgId, deletedAt: null },
      select: { id: true },
    })
    if (!person) {
      return void res.status(422).json({ error: 'The person was not found in this org.' })
    }

    // --- Execute query (upsert on the unique (dealId, personId) key) ---
    const role = await prisma.dealPersonRole.upsert({
      where: { dealId_personId: { dealId, personId: body.personId } },
      create: {
        orgId,
        dealId,
        personId: body.personId,
        role: body.role,
        isPrimary: body.isPrimary ?? false,
      },
      update: {
        role: body.role,
        ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
      },
    })

    logger.info({ orgId, userId, dealId, roleId: role.id }, 'added a deal person-role')

    // --- Return response ---
    res.status(201).json({ role: mapRoleToApi(role) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/deals/:id/roles/:roleId — remove a role
// ============================================================
// A real delete: the person leaves this deal's committee. Scoped to the deal and
// the org, so a role on another deal/org is 404, never confirmed.
router.delete(
  '/:id/roles/:roleId',
  wrapRoute('DELETE /api/orgs/:orgId/deals/:id/roles/:roleId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const dealId = String(req.params.id)
    const roleId = String(req.params.roleId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await loadDealOr404(res, dealId, orgId))) return

    // --- Execute query ---
    const result = await prisma.dealPersonRole.deleteMany({ where: { id: roleId, dealId, orgId } })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Role not found' })
    }

    logger.info({ orgId, userId, dealId, roleId }, 'removed a deal person-role')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
