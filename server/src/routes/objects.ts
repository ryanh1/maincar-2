/**
 * ObjectDef routes — the schema, stored as data (MAI-133, T5). One row per object
 * type in an org (person, company, deal, ... plus whatever the user invents).
 * Standard objects are seeded (T6); this router lets a user create/read/edit CUSTOM
 * objects and hide standard ones.
 *
 * Mounted at /api/orgs/:orgId/objects. The org lives in the path, not in the
 * caller's `currentOrgId`: filtering on a UI preference would let a stale choice
 * decide which tenant's rows a request touches. Every route requires auth and an
 * active membership in the org named by the path.
 *
 * Two guards the database CANNOT enforce, so they live here (spec §5.10, §10.2):
 *   1. A standard ObjectDef (isStandard) can be HIDDEN but never archived or
 *      deleted — the app's own code depends on it existing.
 *   2. A user-created object is always storage="record" and isStandard=false: a
 *      real table ("table") needs a migration, so it cannot be minted at runtime.
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
import { getObjectSurfaceCapabilities } from '../crm/objectCapabilities.js'
import { listFieldChangesInWindow } from '../crm/fieldHistory.js'
import { isRecordGridCreateSupported, listRecords, ListQueryError } from '../crm/recordList.js'
import { Prisma } from '../generated/prisma/client.js'
import type { ObjectDef, AttributeDef } from '../generated/prisma/client.js'

// mergeParams so :orgId from the mount path reaches req.params here — without it
// the tenant filter would silently read undefined.
const router = Router({ mergeParams: true })

const SLUG_ERROR =
  'A slug is lowercase letters, digits and underscores, starting with a letter (e.g. deal_stage).'

const DUPLICATE_SLUG_ERROR = 'An object with this slug already exists in this org.'

// --- Mapper: database row → API shape ---
// orgId and deletedAt are internal and not exposed. attributes are included only
// when the caller asked for them (they are eager-loaded then).
function mapObjectToApi(object: ObjectDef & { attributes?: AttributeDef[] }) {
  return {
    id: object.id,
    slug: object.slug,
    name: object.name,
    namePlural: object.namePlural,
    icon: object.icon,
    iconColor: object.iconColor,
    storage: object.storage,
    isStandard: object.isStandard,
    isFirstClass: object.isFirstClass,
    timelineEventsEnabled: object.timelineEventsEnabled,
    isGridCreateSupported: isRecordGridCreateSupported(object),
    capabilities: getObjectSurfaceCapabilities(object),
    isHidden: object.isHidden,
    isArchived: object.isArchived,
    createdAt: object.createdAt.toISOString(),
    updatedAt: object.updatedAt.toISOString(),
    ...(object.attributes
      ? { attributes: object.attributes.map(mapAttributeToApi) }
      : {}),
  }
}

// A trimmed AttributeDef → API shape, kept here so an object read can embed its
// fields. Mirrors the mapper in attributes.ts.
function mapAttributeToApi(attr: AttributeDef) {
  return {
    id: attr.id,
    objectId: attr.objectId,
    slug: attr.slug,
    name: attr.name,
    description: attr.description,
    icon: attr.icon,
    type: attr.type,
    optionsJson: attr.optionsJson,
    refObjectId: attr.refObjectId,
    formatJson: attr.formatJson,
    validationJson: attr.validationJson,
    isIdentity: attr.isIdentity,
    storage: attr.storage,
    isMulti: attr.isMulti,
    isRequired: attr.isRequired,
    isUnique: attr.isUnique,
    isReadOnly: attr.isReadOnly,
    isSystem: attr.isSystem,
    defaultJson: attr.defaultJson,
    sortOrder: attr.sortOrder,
    isArchived: attr.isArchived,
    createdAt: attr.createdAt.toISOString(),
    updatedAt: attr.updatedAt.toISOString(),
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

// The body for POST /:id/list (MAI-163, MAI-326). A recursive filter tree,
// priority-ordered sort keys, an opaque cursor, and a chunk size — see
// recordList.ts for the compiler.
const filterConditionSchema = z.object({
  type: z.literal('condition'),
  field: z.string().min(1),
  operator: z.enum([
    'eq',
    'neq',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'gt',
    'gte',
    'lt',
    'lte',
    'is_empty',
    'is_not_empty',
    'in',
  ]),
  value: z.unknown().optional(),
})
type FilterNodeInput = z.infer<typeof filterConditionSchema> | { type: 'group'; op: 'and' | 'or'; children: FilterNodeInput[] }
const filterNodeSchema: z.ZodType<FilterNodeInput> = z.lazy(() =>
  z.union([
    filterConditionSchema,
    z.object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(filterNodeSchema).min(1),
    }),
  ]),
)
const teamScopeSchema = z.object({
  teamIds: z.array(z.string().trim().min(1, 'Each team id must be non-empty.')).optional(),
  leadUserIds: z.array(z.string().trim().min(1, 'Each team lead id must be non-empty.')).optional(),
}).strict().refine((scope) => (scope.teamIds?.length ?? 0) + (scope.leadUserIds?.length ?? 0) > 0, {
  message: 'Choose at least one team or team lead.',
})
const sortSpecSchema = z.object({ field: z.string().min(1), direction: z.enum(['asc', 'desc']) })
const listBodySchema = z.object({
  filter: filterNodeSchema.nullish(),
  // Accept the MAI-163 shape while callers move to MAI-326's ordered sort array.
  sort: z.union([sortSpecSchema, z.array(sortSpecSchema).min(1)]).nullish(),
  teamScope: teamScopeSchema.optional(),
  cursor: z.string().nullish(),
  limit: z.number().int().positive().optional(),
})

const fieldChangesQuerySchema = z.object({
  days: z.coerce.number().int().min(1, 'days must be at least 1.').max(365, 'days may not exceed 365.'),
})

const optionalText = z.preprocess(blankToUndefined, z.string().optional())

const slugSchema = z.preprocess(
  blankToUndefined,
  z.string().regex(/^[a-z][a-z0-9_]*$/, SLUG_ERROR).optional(),
)

// The writable body shared by create and update. Everything is optional here; the
// "required on create" checks run after parsing so their messages name the field.
// slug and storage are NOT patchable — see the PATCH handler.
const objectBodySchema = z.object({
  slug: slugSchema,
  name: optionalText,
  namePlural: optionalText,
  icon: optionalText,
  iconColor: optionalText,
  isFirstClass: z.boolean().optional(),
  timelineEventsEnabled: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  isArchived: z.boolean().optional(),
})

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

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/objects — the org's object definitions
// ============================================================
// Returns every non-trashed ObjectDef (standard and custom), so the navbar and
// the field editor can render the whole schema in one call. Ordered by name.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/objects', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const objects = await prisma.objectDef.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
    })

    // --- Return response ---
    res.json({ objects: objects.map((o) => mapObjectToApi(o)) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/objects/:id — one object, with its attributes
// ============================================================
// id AND orgId together, never id alone: a real id in another org matches nothing
// and falls to the 404, so this route never confirms a row it must not reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/objects/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const object = await prisma.objectDef.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        attributes: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    if (!object) {
      return void res.status(404).json({ error: 'Object not found' })
    }

    // --- Return response ---
    res.json({ object: mapObjectToApi(object) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/objects/:id/impact — delete confirmation summary
// ============================================================
router.get(
  '/:id/impact',
  wrapRoute('GET /api/orgs/:orgId/objects/:id/impact', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Verify the object is in this org ---
    const object = await prisma.objectDef.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true, slug: true },
    })
    if (!object) {
      return void res.status(404).json({ error: 'Object not found' })
    }

    // --- Execute query ---
    const [recordCount, inboundAttributes] = await Promise.all([
      prisma.record.count({ where: { orgId, objectId: id, deletedAt: null } }),
      prisma.attributeDef.findMany({
        where: { orgId, refObjectId: id, deletedAt: null, isArchived: false },
        select: {
          objectId: true,
          slug: true,
          name: true,
          object: { select: { name: true } },
        },
      }),
    ])

    const sourceObjectIds = [...new Set(inboundAttributes.map((attribute) => attribute.objectId))]
    const attributeSlugs = [...new Set(inboundAttributes.map((attribute) => attribute.slug))]
    // RecordLink stores a source record id, not its ObjectDef id. Join it to
    // Record so same-named fields on different objects never get merged, while
    // returning only grouped counts instead of every source record/link pair.
    const linkCounts = sourceObjectIds.length > 0 && attributeSlugs.length > 0
      ? await prisma.$queryRaw<{ objectId: string; attribute: string; count: number }[]>(Prisma.sql`
        SELECT record."objectId", link."attribute", COUNT(*)::int AS count
        FROM "RecordLink" AS link
        INNER JOIN "Record" AS record
          ON record."id" = link."fromId"
          AND record."orgId" = link."orgId"
        WHERE link."orgId" = ${orgId}
          AND link."fromObject" = 'record'
          AND link."toObject" = ${object.slug}
          AND link."attribute" IN (${Prisma.join(attributeSlugs)})
          AND record."objectId" IN (${Prisma.join(sourceObjectIds)})
          AND record."deletedAt" IS NULL
        GROUP BY record."objectId", link."attribute"
      `)
      : []
    const countBySourceAndAttribute = new Map<string, number>()
    for (const link of linkCounts) {
      const key = `${link.objectId}:${link.attribute}`
      countBySourceAndAttribute.set(key, link.count)
    }
    const references = inboundAttributes
      .map((attribute) => ({
        objectName: attribute.object.name,
        fieldName: attribute.name,
        count: countBySourceAndAttribute.get(`${attribute.objectId}:${attribute.slug}`) ?? 0,
      }))
      .filter((reference) => reference.count > 0)

    // --- Return response ---
    res.json({ recordCount, references })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/objects/:id/field-changes — recent changed cells
// ============================================================
// The grid uses this as an overlay data source, not a row filter. AttributeDef
// is the field-read boundary in the current CRM schema: history for an archived
// or deleted field must not be returned even when its append-only rows remain.
router.get(
  '/:id/field-changes',
  wrapRoute('GET /api/orgs/:orgId/objects/:id/field-changes', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = fieldChangesQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Verify the object and resolve readable fields ---
    const object = await prisma.objectDef.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { slug: true },
    })
    if (!object) {
      return void res.status(404).json({ error: 'Object not found' })
    }
    const attributes = await prisma.attributeDef.findMany({
      where: { orgId, objectId: id, isArchived: false, deletedAt: null },
      select: { id: true, slug: true },
    })
    const attributeIdBySlug = new Map(attributes.map((attribute) => [attribute.slug, attribute.id]))

    // --- Execute query ---
    const changes = await listFieldChangesInWindow(prisma, {
      orgId,
      objectSlug: object.slug,
      readableAttributes: attributes.map((attribute) => attribute.slug),
      days: parsed.data.days,
    })

    // --- Return response ---
    res.json({
      changes: changes.map((change) => ({
        recordId: change.recordId,
        attributeId: attributeIdBySlug.get(change.attribute),
        changeCount: change.changeCount,
        previousValue: change.previousValue,
        currentValue: change.currentValue,
        changedAt: change.changedAt.toISOString(),
      })),
    })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/objects/:id/list — server sort/filter/count + cursor
// windows over the object's rows (MAI-163, plan T0.1, spec CHUNK-1 §A).
// ============================================================
// One endpoint the grid calls for every window of rows, whichever storage the
// object uses (recordList.ts picks the real table vs. the generic Record table).
// The query is a body, not a query-string, because the filter tree nests
// arbitrarily. Response is exactly { rows, nextCursor, totalCount } per spec.
router.post(
  '/:id/list',
  wrapRoute('POST /api/orgs/:orgId/objects/:id/list', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Load the object + its live attributes (org-scoped) ---
    const object = await prisma.objectDef.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!object) {
      return void res.status(404).json({ error: 'Object not found' })
    }
    const attributes = await prisma.attributeDef.findMany({
      where: { orgId, objectId: id, deletedAt: null, isArchived: false },
    })

    // --- Execute query ---
    try {
      const result = await listRecords(prisma, { orgId, object, attributes, query: parsed.data })
      // --- Return response ---
      res.json(result)
    } catch (error) {
      if (error instanceof ListQueryError) {
        return void res.status(error.status).json({ error: error.message })
      }
      throw error
    }
  }),
)

// ============================================================
// POST /api/orgs/:orgId/objects — create a custom object
// ============================================================
// A user-created object is always storage="record" and isStandard=false: a real
// table needs a migration, so it cannot be minted at runtime (spec §5.1). orgId
// comes from the path, never the body; slug is unique per org (409 on a clash).
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/objects', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = objectBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    if (!body.slug) {
      return void res.status(422).json({ error: 'An object needs a slug.' })
    }
    if (!body.name || !body.namePlural) {
      return void res.status(422).json({ error: 'An object needs a name and a plural name.' })
    }

    // --- Execute query ---
    // storage and isStandard are forced, never taken from the body: only the seed
    // creates a table-backed standard object.
    const data: Prisma.ObjectDefUncheckedCreateInput = {
      orgId,
      slug: body.slug,
      name: body.name,
      namePlural: body.namePlural,
      icon: body.icon,
      iconColor: body.iconColor,
      storage: 'record',
      isStandard: false,
      isFirstClass: body.isFirstClass ?? true,
      timelineEventsEnabled: body.timelineEventsEnabled ?? false,
    }
    let created: ObjectDef
    try {
      created = await prisma.objectDef.create({ data })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: DUPLICATE_SLUG_ERROR })
      }
      throw error
    }

    logger.info({ orgId, userId, objectId: created.id }, 'created a custom object')

    // --- Return response ---
    res.status(201).json({ object: mapObjectToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/objects/:id — update an object
// ============================================================
// Display fields (name, plural, icon, color, isFirstClass) and isHidden are
// editable on any object. isArchived is blocked on a standard object — a standard
// object can be hidden, never archived (spec §10.2). slug and storage are never
// patchable: slug is the object's stable identity and storage is fixed at create.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/objects/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = objectBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.objectDef.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Object not found' })
    }

    // --- Guard: a standard object can be hidden, never archived (spec §10.2) ---
    if (existing.isStandard && body.isArchived === true) {
      return void res
        .status(422)
        .json({ error: 'A standard object cannot be archived. Hide it instead.' })
    }

    // --- Build the update, honoring "sent key" vs "absent key" ---
    const data: Record<string, unknown> = {}
    if ('name' in raw && body.name) data.name = body.name
    if ('namePlural' in raw && body.namePlural) data.namePlural = body.namePlural
    if ('icon' in raw) data.icon = blankToNull(raw.icon) as string | null
    if ('iconColor' in raw) data.iconColor = blankToNull(raw.iconColor) as string | null
    if (body.isFirstClass !== undefined) data.isFirstClass = body.isFirstClass
    if (body.timelineEventsEnabled !== undefined) data.timelineEventsEnabled = body.timelineEventsEnabled
    if (body.isHidden !== undefined) data.isHidden = body.isHidden
    if (body.isArchived !== undefined) data.isArchived = body.isArchived

    // --- Execute query ---
    const result = await prisma.objectDef.updateMany({
      where: { id, orgId, deletedAt: null },
      data,
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Object not found' })
    }

    logger.info({ orgId, userId, objectId: id }, 'updated an object')

    // --- Return response ---
    const updated = await prisma.objectDef.findFirst({ where: { id, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Object not found' })
    }
    res.json({ object: mapObjectToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/objects/:id — soft-delete a custom object
// ============================================================
// A standard object can never be deleted, only hidden (spec §10.2) — that is a
// 422, not a 404, because the object is real and visible, the action is what is
// refused. A custom object soft-deletes into the 30-day trash (spec §5.10).
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/objects/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Load the current row to check the standard-object guard ---
    const existing = await prisma.objectDef.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Object not found' })
    }
    if (existing.isStandard) {
      return void res
        .status(422)
        .json({ error: 'A standard object cannot be deleted. Hide it instead.' })
    }

    // --- Execute query ---
    const result = await prisma.objectDef.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Object not found' })
    }

    logger.info({ orgId, userId, objectId: id }, 'trashed a custom object')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
