/**
 * List and ListEntry routes — a saved working set of records, and the process
 * that runs on it (MAI-142 T14; spec §5.3, §6, impacts §K).
 *
 * Mounted at /api/orgs/:orgId/lists. Entries are mounted UNDER a list
 * (/lists/:id/entries), never on their own: an entry is only ever reachable
 * through the list it belongs to, which is also where its tenant boundary gets
 * proven. Every route requires auth and an active membership in the org named by
 * the path, and every read AND write carries the orgId filter —
 * `findFirst`/`updateMany` with orgId, never by id alone
 * (.claude/rules/database-and-prisma.md).
 *
 * THREE RULES THIS FILE HOLDS TO — see the schema.prisma header above `model
 * List` for the full reasoning:
 *
 *   1. ONE OBJECT TYPE PER LIST. `objectSlug` is set at create and never
 *      patchable. Every entry's `objectSlug` is COPIED FROM THE LIST, never
 *      accepted from the request — it is not even in the entry body schemas.
 *   2. ENTRY VALUES ARE THE LIST'S, NOT THE RECORD'S. `valuesJson` on a
 *      ListEntry is validated against AttributeDef rows whose storage is
 *      "list", through the SAME validator every other custom value goes
 *      through (server/src/crm/valuesValidator.ts). Writing them touches no
 *      Record row.
 *   3. `slug` IS DERIVED AND NEVER PATCHABLE. A caller may supply one at create
 *      (validated and checked for a clash); otherwise it is derived from `name`
 *      and de-duplicated. A list's slug never moves once created, the same way
 *      a custom object's slug never moves (server/src/routes/objects.ts).
 *
 * ADDING A RECORD TO A LIST IS IDEMPOTENT: `@@unique([listId, objectSlug,
 * targetId])` means a second POST of the same target returns the existing entry
 * (200) instead of erroring or duplicating the row.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { validateRecordValues, type ValidatorAttribute } from '../crm/valuesValidator.js'
import { verifyLinkTargets } from '../crm/workLinks.js'
import { listRecords } from '../crm/recordList.js'
import type { AttributeDef, List, ListEntry, Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100

const LIST_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const
const ENTRY_SORT_FIELDS = ['position', 'createdAt', 'updatedAt'] as const

// A slug is url-safe on purpose: unlike an ObjectDef slug (a programmatic
// identifier, underscored), a List slug is meant to sit in a saved link.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SLUG_ERROR = 'A slug is lowercase letters, digits, and hyphens, like q3-outbound-blitz.'

/** An untouched optional query param arrives as `""`, which means "no filter". */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

// A trimmed non-empty string, or NULL. "" and null both mean "clear the field";
// an absent key means "leave it alone" (checked by the caller via `in`).
function blankToNull(value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

const optionalBool = z.preprocess(
  blankToUndefined,
  z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
)

const slugSchema = z.preprocess(
  blankToUndefined,
  z.string().regex(SLUG_RE, SLUG_ERROR).max(80).optional(),
)

// --- Mappers: database row → API shape ---
// orgId and deletedAt are internal and not exposed.
function mapListToApi(list: List) {
  return {
    id: list.id,
    name: list.name,
    slug: list.slug,
    objectSlug: list.objectSlug,
    description: list.description,
    icon: list.icon,
    ownerUserId: list.ownerUserId,
    isArchived: list.isArchived,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  }
}

function mapEntryToApi(entry: ListEntry) {
  return {
    id: entry.id,
    listId: entry.listId,
    objectSlug: entry.objectSlug,
    targetId: entry.targetId,
    values: entry.valuesJson,
    position: entry.position,
    addedByUserId: entry.addedByUserId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

/**
 * Is this user someone this org may hand a list to? An ACTIVE membership,
 * checked server-side — the same guard tasks.ts uses for `assigneeUserId`,
 * because an owner id arrives in the body and a body is not evidence.
 */
async function ownerIsMember(orgId: string, userId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { orgId, userId, isActive: true },
    select: { id: true },
  })
  return membership !== null
}

/** The ObjectDef a slug names in this org, or null. Any storage — spine or custom. */
async function resolveObjectBySlug(
  orgId: string,
  slug: string,
): Promise<{ id: string; slug: string; storage: string } | null> {
  return prisma.objectDef.findFirst({
    where: { orgId, slug, deletedAt: null },
    select: { id: true, slug: true, storage: true },
  })
}

// The active list-scoped attributes for an object: not deleted, not archived,
// and storage="list" — the counterpart of records.ts's loadValueAttributes,
// which excludes exactly these (rule 2 in the module header).
async function loadEntryAttributes(orgId: string, objectId: string): Promise<AttributeDef[]> {
  return prisma.attributeDef.findMany({
    where: { orgId, objectId, deletedAt: null, isArchived: false, storage: 'list' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

function toValidatorAttribute(attr: AttributeDef): ValidatorAttribute {
  return {
    slug: attr.slug,
    name: attr.name,
    type: attr.type,
    isRequired: attr.isRequired,
    isUnique: attr.isUnique,
    isMulti: attr.isMulti,
    isReadOnly: attr.isReadOnly,
    optionsJson: attr.optionsJson ?? undefined,
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || 'list'
}

/**
 * The first free slug starting from `base`: `base`, then `base-2`, `base-3`, ...
 *
 * Checked against every row regardless of `deletedAt` — the unique index is
 * `@@unique([orgId, slug])` with no `deletedAt` in it, so a trashed list still
 * occupies its slug at the database level, and this must agree.
 */
async function nextFreeSlug(orgId: string, base: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await prisma.list.findFirst({ where: { orgId, slug: candidate }, select: { id: true } })
    if (!clash) return candidate
  }
  throw new Error(`Could not find a free slug for "${base}" in org ${orgId}.`)
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

router.use(requireAuth)

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z.enum(LIST_SORT_FIELDS, { error: `Sort by one of: ${LIST_SORT_FIELDS.join(', ')}.` }).default('name'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('asc'),
  objectSlug: optionalId,
  isArchived: optionalBool,
  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

// ============================================================
// GET /api/orgs/:orgId/lists — the org's lists
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/lists', async (req, res) => {
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
    const { page, limit, sort, dir, objectSlug, isArchived, q } = parsed.data

    // --- Build filters ---
    const where: Prisma.ListWhereInput = {
      orgId,
      deletedAt: null,
      ...(objectSlug ? { objectSlug } : {}),
      // A list is active by default; ask isArchived=true to see the archived ones.
      isArchived: isArchived ?? false,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    }

    // --- Execute query ---
    const orderBy: Prisma.ListOrderByWithRelationInput[] =
      sort === 'name' ? [{ name: dir }] : [{ [sort]: dir }, { name: 'asc' as const }]

    const [total, lists] = await Promise.all([
      prisma.list.count({ where }),
      prisma.list.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    ])

    // --- Return response ---
    res.json({ lists: lists.map((list) => mapListToApi(list)), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/lists/:id — one list
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/lists/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const list = await prisma.list.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!list) {
      return void res.status(404).json({ error: 'List not found' })
    }

    // --- Return response ---
    res.json({ list: mapListToApi(list) })
  }),
)

const createListBodySchema = z.object({
  name: z.string().trim().min(1, 'A list needs a name.').max(200, 'That name is too long.'),
  objectSlug: z.string().trim().min(1, 'A list needs an objectSlug.').max(60),
  slug: slugSchema,
  description: z.string().max(2000, 'That description is too long.').nullish(),
  icon: z.string().max(100).nullish(),
  ownerUserId: z.string().trim().min(1).nullish(),
})

// ============================================================
// POST /api/orgs/:orgId/lists — create a list
// ============================================================
// The T14 acceptance criterion lives here: `objectSlug` is set once and verified
// against an ObjectDef in this org, so a list always holds exactly one object
// type. `slug` is derived from `name` when the caller omits it.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/lists', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = createListBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Verify the object exists in this org ---
    const object = await resolveObjectBySlug(orgId, body.objectSlug)
    if (!object) {
      return void res.status(422).json({ error: `This org has no object called "${body.objectSlug}".` })
    }

    // --- Verify the owner is in this org ---
    if (body.ownerUserId && !(await ownerIsMember(orgId, body.ownerUserId))) {
      return void res.status(422).json({ error: 'That owner is not a member of this org.' })
    }

    // --- Resolve the slug ---
    const slug = body.slug ?? (await nextFreeSlug(orgId, slugify(body.name)))

    // --- Execute query ---
    const data: Prisma.ListUncheckedCreateInput = {
      // orgId from the PATH, never the body.
      orgId,
      name: body.name,
      slug,
      objectSlug: object.slug,
      description: body.description ?? null,
      icon: body.icon ?? null,
      ownerUserId: body.ownerUserId ?? null,
    }
    let created: List
    try {
      created = await prisma.list.create({ data })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: 'A list with this slug already exists in this org.' })
      }
      throw error
    }

    logger.info({ orgId, userId, listId: created.id, objectSlug: created.objectSlug }, 'created a list')

    // --- Return response ---
    res.status(201).json({ list: mapListToApi(created) })
  }),
)

const updateListBodySchema = z.object({
  name: z.string().trim().min(1, 'A list needs a name.').max(200, 'That name is too long.').optional(),
  description: z.string().max(2000, 'That description is too long.').nullish(),
  icon: z.string().max(100).nullish(),
  ownerUserId: z.string().trim().min(1).nullish(),
  isArchived: z.boolean().optional(),
})

// ============================================================
// PATCH /api/orgs/:orgId/lists/:id — rename, re-describe, re-own, archive
// ============================================================
// `slug` and `objectSlug` are never patchable — see rule 1 and rule 3 in the
// module header. A key present-but-null on a nullish field CLEARS it; an absent
// key leaves it alone.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/lists/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = updateListBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.list.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'List not found' })
    }

    if (body.ownerUserId && !(await ownerIsMember(orgId, body.ownerUserId))) {
      return void res.status(422).json({ error: 'That owner is not a member of this org.' })
    }

    // --- Build the update, honoring "sent key" vs "absent key" ---
    const data: Prisma.ListUncheckedUpdateManyInput = {}
    if (body.name !== undefined) data.name = body.name
    if ('description' in raw) data.description = blankToNull(raw.description) as string | null
    if ('icon' in raw) data.icon = blankToNull(raw.icon) as string | null
    if ('ownerUserId' in raw) data.ownerUserId = body.ownerUserId ?? null
    if (body.isArchived !== undefined) data.isArchived = body.isArchived

    // --- Execute query ---
    const result = await prisma.list.updateMany({ where: { id, orgId, deletedAt: null }, data })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'List not found' })
    }

    logger.info({ orgId, userId, listId: id }, 'updated a list')

    // --- Return response ---
    const updated = await prisma.list.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!updated) {
      return void res.status(404).json({ error: 'List not found' })
    }
    res.json({ list: mapListToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/lists/:id — soft-delete into the 30-day trash
// ============================================================
// Entries are left alone: a soft-deleted List still owns its rows, so restoring
// the list restores what was on it. They simply become unreachable in the
// meantime — every entries route below checks the parent list is not trashed.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/lists/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.list.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'List not found' })
    }

    logger.info({ orgId, userId, listId: id }, 'trashed a list')

    // --- Return response ---
    res.status(204).send()
  }),
)

// ============================================================================
// Entries — /api/orgs/:orgId/lists/:id/entries
// ============================================================================

const entryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z
    .enum(ENTRY_SORT_FIELDS, { error: `Sort by one of: ${ENTRY_SORT_FIELDS.join(', ')}.` })
    .default('position'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('asc'),
})

// A list this org owns and has not trashed, or null. Shared by every /entries
// route below — an entry is only ever reachable through its (non-trashed) list.
async function loadOwningList(orgId: string, listId: string): Promise<List | null> {
  return prisma.list.findFirst({ where: { id: listId, orgId, deletedAt: null } })
}

/**
 * Load the compatible target rows for one page of list membership. The list
 * entry remains the source of manual order and list-only values; this is a
 * read-only join so opening a list can never write through to a record.
 */
async function loadEntryTargets(orgId: string, list: List, entries: ListEntry[]): Promise<Map<string, Record<string, unknown>>> {
  if (entries.length === 0) return new Map()

  const object = await resolveObjectBySlug(orgId, list.objectSlug)
  if (!object) return new Map()

  const attributes = await prisma.attributeDef.findMany({
    where: { orgId, objectId: object.id, deletedAt: null, isArchived: false },
  })
  const result = await listRecords(prisma, {
    orgId,
    object,
    attributes,
    query: {
      filter: { type: 'condition', field: 'id', operator: 'in', value: entries.map((entry) => entry.targetId) },
      limit: LIST_MAX_LIMIT,
    },
  })

  return new Map(result.rows.map((row) => [String(row.id), row] as const))
}

// ============================================================
// GET /api/orgs/:orgId/lists/:id/entries — the list's rows
// ============================================================
// Manually ordered by `position` (nulls last, same convention tasks.ts uses for
// dueAt): a list that has never been hand-ordered sorts by when a row was added.
router.get(
  '/:id/entries',
  wrapRoute('GET /api/orgs/:orgId/lists/:id/entries', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const listId = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const list = await loadOwningList(orgId, listId)
    if (!list) {
      return void res.status(404).json({ error: 'List not found' })
    }

    // --- Parse & validate params ---
    const parsed = entryListQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit, sort, dir } = parsed.data

    // --- Execute query ---
    const where: Prisma.ListEntryWhereInput = { orgId, listId }
    const orderBy: Prisma.ListEntryOrderByWithRelationInput[] =
      sort === 'position'
        ? [{ position: { sort: dir, nulls: 'last' } }, { createdAt: 'asc' as const }]
        : [{ [sort]: dir }, { createdAt: 'asc' as const }]

    const [total, entries] = await Promise.all([
      prisma.listEntry.count({ where }),
      prisma.listEntry.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    ])
    const targets = await loadEntryTargets(orgId, list, entries)

    // --- Return response ---
    res.json({
      entries: entries.map((entry) => ({ ...mapEntryToApi(entry), target: targets.get(entry.targetId) ?? null })),
      total,
      page,
      limit,
    })
  }),
)

const createEntryBodySchema = z.object({
  targetId: z.string().trim().min(1, 'An entry needs a targetId.'),
  // objectSlug is deliberately absent — see rule 1 in the module header.
  valuesJson: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================
// POST /api/orgs/:orgId/lists/:id/entries — add a record to the list
// ============================================================
// IDEMPOTENT (see the module header): adding the same record twice returns the
// existing entry with 200, never a duplicate row or an error.
router.post(
  '/:id/entries',
  wrapRoute('POST /api/orgs/:orgId/lists/:id/entries', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const listId = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const list = await loadOwningList(orgId, listId)
    if (!list) {
      return void res.status(404).json({ error: 'List not found' })
    }

    // --- Parse & validate params ---
    const parsed = createEntryBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Idempotent add: an existing entry is returned as-is ---
    const existing = await prisma.listEntry.findFirst({
      where: { orgId, listId, objectSlug: list.objectSlug, targetId: body.targetId },
    })
    if (existing) {
      return void res.status(200).json({ entry: mapEntryToApi(existing) })
    }

    // --- Verify the target record exists in this org ---
    const badTarget = await verifyLinkTargets(prisma, orgId, [{ object: list.objectSlug, id: body.targetId }])
    if (badTarget) {
      return void res.status(422).json({ error: badTarget })
    }

    // --- Validate the entry's list-only values (rule 2) ---
    const object = await resolveObjectBySlug(orgId, list.objectSlug)
    if (!object) {
      return void res.status(422).json({ error: `This org has no object called "${list.objectSlug}".` })
    }
    const attributes = (await loadEntryAttributes(orgId, object.id)).map(toValidatorAttribute)
    const validated = await validateRecordValues({
      attributes,
      input: body.valuesJson ?? {},
      mode: 'create',
    })
    if (!validated.ok) {
      return void res.status(422).json({ error: validated.error })
    }

    // --- Execute query ---
    let created: ListEntry
    try {
      created = await prisma.listEntry.create({
        data: {
          orgId,
          listId,
          // Copied from the LIST, never accepted from the request (rule 1).
          objectSlug: list.objectSlug,
          targetId: body.targetId,
          valuesJson: validated.values as Prisma.InputJsonValue,
          addedByUserId: userId,
        },
      })
    } catch (error) {
      // A race with another concurrent add of the same target — the idempotent
      // check above missed it by a beat. Read back and return it the same way.
      if (isUniqueViolation(error)) {
        const raced = await prisma.listEntry.findFirst({
          where: { orgId, listId, objectSlug: list.objectSlug, targetId: body.targetId },
        })
        if (raced) return void res.status(200).json({ entry: mapEntryToApi(raced) })
      }
      throw error
    }

    logger.info({ orgId, userId, listId, entryId: created.id }, 'added a record to a list')

    // --- Return response ---
    res.status(201).json({ entry: mapEntryToApi(created) })
  }),
)

const updateEntryBodySchema = z.object({
  valuesJson: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().nullish(),
})

// ============================================================
// PATCH /api/orgs/:orgId/lists/:id/entries/:entryId — edit values or reorder
// ============================================================
// `targetId`/`objectSlug` are never patchable: they are the identity of the
// entry (the unique key), not editable state.
router.patch(
  '/:id/entries/:entryId',
  wrapRoute('PATCH /api/orgs/:orgId/lists/:id/entries/:entryId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const listId = String(req.params.id)
    const entryId = String(req.params.entryId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const list = await loadOwningList(orgId, listId)
    if (!list) {
      return void res.status(404).json({ error: 'List not found' })
    }

    // --- Parse & validate params ---
    const parsed = updateEntryBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Load the current row (list- and org-scoped) ---
    const existing = await prisma.listEntry.findFirst({ where: { id: entryId, listId, orgId } })
    if (!existing) {
      return void res.status(404).json({ error: 'Entry not found' })
    }

    // --- Build the update ---
    const data: Prisma.ListEntryUncheckedUpdateManyInput = {}

    if (body.valuesJson !== undefined) {
      const object = await resolveObjectBySlug(orgId, list.objectSlug)
      if (!object) {
        return void res.status(422).json({ error: `This org has no object called "${list.objectSlug}".` })
      }
      const attributes = (await loadEntryAttributes(orgId, object.id)).map(toValidatorAttribute)
      const validated = await validateRecordValues({
        attributes,
        input: body.valuesJson,
        mode: 'update',
        current: existing.valuesJson as Record<string, unknown>,
      })
      if (!validated.ok) {
        return void res.status(422).json({ error: validated.error })
      }
      data.valuesJson = validated.values as Prisma.InputJsonValue
    }
    if (body.position !== undefined) data.position = body.position

    // --- Execute query ---
    if (Object.keys(data).length > 0) {
      const result = await prisma.listEntry.updateMany({ where: { id: entryId, listId, orgId }, data })
      if (result.count === 0) {
        return void res.status(404).json({ error: 'Entry not found' })
      }
    }

    logger.info({ orgId, userId, listId, entryId }, 'updated a list entry')

    // --- Return response ---
    const updated = await prisma.listEntry.findFirst({ where: { id: entryId, listId, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Entry not found' })
    }
    res.json({ entry: mapEntryToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/lists/:id/entries/:entryId — remove from the list
// ============================================================
// A hard delete, unlike List/Task/Note: list MEMBERSHIP is not itself a record
// worth keeping in the 30-day trash the way a note or a task is, and re-adding a
// removed record is exactly one more POST away.
router.delete(
  '/:id/entries/:entryId',
  wrapRoute('DELETE /api/orgs/:orgId/lists/:id/entries/:entryId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const listId = String(req.params.id)
    const entryId = String(req.params.entryId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const list = await loadOwningList(orgId, listId)
    if (!list) {
      return void res.status(404).json({ error: 'List not found' })
    }

    // --- Execute query ---
    const result = await prisma.listEntry.deleteMany({ where: { id: entryId, listId, orgId } })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Entry not found' })
    }

    logger.info({ orgId, userId, listId, entryId }, 'removed a record from a list')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
