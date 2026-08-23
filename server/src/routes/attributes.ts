/**
 * AttributeDef routes — the fields, stored as data (MAI-133, T5). One row per
 * field on an object. This is the whole point of schema-as-data: creating a
 * custom field is a ROW INSERT here, never an ALTER TABLE (spec §5.1).
 *
 * Mounted at /api/orgs/:orgId/attributes. An attribute belongs to an object, so
 * create carries an objectId in the body and list filters by it in the query.
 * The org lives in the path, not in the caller's `currentOrgId`. Every route
 * requires auth and an active membership in the org named by the path.
 *
 * Two guards the database CANNOT enforce, so they live here (spec §5.11, §10.2):
 *   1. An isSystem field can be renamed / re-described / hidden, but never DELETED
 *      or RETYPED — a workflow, the dialer, or reporting is keyed on its type.
 *   2. A user-created field is always isSystem=false and never storage="column":
 *      a real column needs a migration, so it cannot be minted at runtime. Runtime
 *      fields live in customJson ("custom") or ListEntry.valuesJson ("list").
 *
 * The tenant boundary is the orgId filter on every read AND write: reads go
 * through findFirst({ where: { id, orgId } }) and writes through updateMany({
 * where: { id, orgId } }), never update-by-id (.claude/rules/database-and-prisma.md).
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { TABLE_STORAGE_TABLES } from '../crm/recordList.js'
import { Prisma } from '../generated/prisma/client.js'
import type { AttributeDef } from '../generated/prisma/client.js'

// mergeParams so :orgId from the mount path reaches req.params here — without it
// the tenant filter would silently read undefined.
const router = Router({ mergeParams: true })

// The semantic attribute types (spec §8). A fixed system enum: a plain String
// column plus this TS union, never a Prisma enum. Type the MEANING, not the
// storage — each type removes a class of hand-written glue code (§5.6, §8).
const ATTRIBUTE_TYPES = [
  'text',
  'number',
  'checkbox',
  'date',
  'timestamp',
  'phone',
  'email',
  'url',
  'domain',
  'select',
  'multiselect',
  'status',
  'currency',
  'rating',
  'location',
  'person_name',
  'record_reference',
  'user_reference',
  'ai',
] as const

// Where an attribute's value physically sits (spec §5.1). "column" is reserved for
// seeded system fields (it maps to a real table column); a user can only add a
// field that lands in JSON — customJson ("custom") or ListEntry.valuesJson ("list").
const STORAGES = ['column', 'custom', 'list'] as const

const SLUG_ERROR =
  'A slug is letters, digits and underscores, starting with a letter (e.g. renewal_month).'

const DUPLICATE_SLUG_ERROR = 'A field with this slug already exists on this object.'

// --- Mapper: database row → API shape ---
// orgId and deletedAt are internal and not exposed.
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

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function blankToNull(value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const optionalText = z.preprocess(blankToUndefined, z.string().optional())

// optionsJson is an array of picklist options (spec §5.6a). value + label are
// required per option; color/order/isArchived are optional. Extra keys pass through.
const optionSchema = z
  .object({
    value: z.string().min(1, 'Each option needs a value.'),
    label: z.string().min(1, 'Each option needs a label.'),
    color: z.string().optional(),
    order: z.number().optional(),
    isArchived: z.boolean().optional(),
  })
  .loose()

// A JSON object blob (formatJson / validationJson / defaultJson). Kept permissive
// on purpose — the shape is per-type and validated by the value validator (T7),
// not here.
const jsonObject = z.record(z.string(), z.unknown())

const slugSchema = z.preprocess(
  blankToUndefined,
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, SLUG_ERROR).optional(),
)

// The writable body shared by create and update. Everything is optional here; the
// "required on create" and guard checks run after parsing. objectId, slug, type and
// storage are create-only anchors — see the handlers.
const attributeBodySchema = z.object({
  objectId: z.preprocess(blankToUndefined, z.string().optional()),
  slug: slugSchema,
  name: optionalText,
  description: optionalText,
  icon: optionalText,
  type: z
    .enum(ATTRIBUTE_TYPES, { error: `type is one of: ${ATTRIBUTE_TYPES.join(', ')}.` })
    .optional(),
  storage: z
    .enum(STORAGES, { error: `storage is one of: ${STORAGES.join(', ')}.` })
    .optional(),
  optionsJson: z.array(optionSchema).optional(),
  refObjectId: z.preprocess(blankToUndefined, z.string().optional()),
  formatJson: jsonObject.optional(),
  validationJson: jsonObject.optional(),
  defaultJson: jsonObject.optional(),
  isIdentity: z.boolean().optional(),
  isMulti: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isArchived: z.boolean().optional(),
})

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

// ============================================================
// Option CRUD (journey 4b.5.3, SPEC-CHUNK-2 J2.5 §A)
// ============================================================
// A select/status/multiselect field's options live in optionsJson. These routes
// edit ONE option at a time so the careful operations — value rename (a bulk
// record migration) and reassign-and-remove — can be guarded and atomic, rather
// than a whole-array PATCH that a caller could get wrong.

// The muted palette (design-system.md → Color). Options store the token NAME,
// never a hex, so a swatch edit recolours every chip/board column and dark mode
// stays correct. Mirrors vite/src/lib/optionPalette.ts.
const OPTION_COLOR_TOKENS = [
  'option-1',
  'option-2',
  'option-3',
  'option-4',
  'option-5',
  'option-6',
  'option-7',
  'option-8',
] as const

// AttributeDef.slug is already constrained to this shape at creation time; re-checked
// here before a slug is interpolated as a bare SQL identifier in the migration.
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// The option-bearing types. Only these carry an editable optionsJson list.
const OPTION_TYPES = new Set(['select', 'status', 'multiselect'])

interface StoredOption {
  value: string
  label: string
  color?: string
  order?: number
  isArchived?: boolean
}

function readOptions(attribute: AttributeDef): StoredOption[] {
  if (!Array.isArray(attribute.optionsJson)) return []
  return (attribute.optionsJson as unknown[]).filter(
    (option): option is StoredOption =>
      typeof option === 'object' && option !== null && typeof (option as { value?: unknown }).value === 'string',
  ) as StoredOption[]
}

// Auto-assign the next unused muted token when an option is added (journey 4b.5.1).
function nextOptionToken(existing: StoredOption[]): string {
  const used = new Set(
    existing
      .map((option) => option.color)
      .filter((color): color is string => typeof color === 'string' && (OPTION_COLOR_TOKENS as readonly string[]).includes(color)),
  )
  for (const token of OPTION_COLOR_TOKENS) {
    if (!used.has(token)) return token
  }
  return OPTION_COLOR_TOKENS[0]
}

// The object + attribute an option route needs, both org-scoped. The object is
// required so a value rename can migrate the real storage (column / customJson /
// valuesJson / ListEntry.valuesJson).
async function loadAttributeWithObject(
  orgId: string,
  id: string,
): Promise<{ attribute: AttributeDef; object: { id: string; slug: string; storage: string } } | null> {
  const attribute = await prisma.attributeDef.findFirst({ where: { id, orgId, deletedAt: null } })
  if (!attribute) return null
  const object = await prisma.objectDef.findFirst({
    where: { id: attribute.objectId, orgId, deletedAt: null },
    select: { id: true, slug: true, storage: true },
  })
  if (!object) return null
  return { attribute, object }
}

// The storage location of a single-valued option, resolved from the object's
// storage surface. `column` maps to a real table column; `custom` maps to a JSONB
// bag (customJson on a table-backed object, valuesJson on a record-backed one);
// `list` maps to ListEntry.valuesJson.
interface OptionValueLocation {
  tableName: string
  kind: 'column' | 'json'
  columnName?: string
  jsonColumn?: string
  objectId?: string
  objectSlug?: string
  hasDeletedAt: boolean
}

function resolveOptionValueLocation(
  object: { id: string; slug: string; storage: string },
  attribute: { slug: string; storage: string },
): OptionValueLocation | null {
  if (!SAFE_IDENTIFIER.test(attribute.slug)) return null
  if (attribute.storage === 'column') {
    const tableName = TABLE_STORAGE_TABLES[object.slug]
    if (!tableName) return null
    return { tableName, kind: 'column', columnName: attribute.slug, hasDeletedAt: true }
  }
  if (attribute.storage === 'list') {
    return { tableName: 'ListEntry', kind: 'json', jsonColumn: 'valuesJson', objectSlug: object.slug, hasDeletedAt: false }
  }
  // custom storage
  const isRecord = object.storage === 'record'
  const tableName = isRecord ? 'Record' : TABLE_STORAGE_TABLES[object.slug]
  if (!tableName) return null
  return {
    tableName,
    kind: 'json',
    jsonColumn: isRecord ? 'valuesJson' : 'customJson',
    ...(isRecord ? { objectId: object.id } : {}),
    hasDeletedAt: true,
  }
}

// Count the records that currently hold `oldValue` for this option (the warning
// number shown before a rename or a reassign-and-remove).
export async function countOptionValue(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    value: string
  },
): Promise<number> {
  const location = resolveOptionValueLocation(args.object, args.attribute)
  if (!location) return 0
  const { orgId, value } = args

  if (location.kind === 'column') {
    const rows = await client.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM ${Prisma.raw(`"${location.tableName}"`)}
      WHERE "orgId" = ${orgId}
        AND ${Prisma.raw(`"${location.columnName!}"`)} = ${value}
        AND "deletedAt" IS NULL
    `
    return Number(rows[0]?.count ?? 0)
  }

  const objectFilter = location.objectId
    ? Prisma.sql`AND "objectId" = ${location.objectId}`
    : location.objectSlug
      ? Prisma.sql`AND "objectSlug" = ${location.objectSlug}`
      : Prisma.empty
  const deletedAtFilter = location.hasDeletedAt ? Prisma.sql`AND "deletedAt" IS NULL` : Prisma.empty
  const valueFilter = args.attribute.isMulti
    ? Prisma.sql`${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} ? ${value}`
    : Prisma.sql`${Prisma.raw(`"${location.jsonColumn!}"`)} ->> ${args.attribute.slug} = ${value}`
  const rows = await client.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM ${Prisma.raw(`"${location.tableName}"`)}
    WHERE "orgId" = ${orgId}
      ${objectFilter}
      AND ${valueFilter}
      ${deletedAtFilter}
  `
  return Number(rows[0]?.count ?? 0)
}

// Atomically migrate every record that holds `oldValue` to `newValue`, across the
// attribute's real storage. Returns the number of rows changed. Single-valued
// (select/status) only — a multiselect array rename is a separate concern.
export async function migrateOptionValue(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    oldValue: string
    newValue: string
  },
): Promise<number> {
  const location = resolveOptionValueLocation(args.object, args.attribute)
  if (!location) return 0
  const { orgId, oldValue, newValue } = args

  if (location.kind === 'column') {
    return client.$executeRaw`
      UPDATE ${Prisma.raw(`"${location.tableName}"`)}
      SET ${Prisma.raw(`"${location.columnName!}"`)} = ${newValue}
      WHERE "orgId" = ${orgId}
        AND ${Prisma.raw(`"${location.columnName!}"`)} = ${oldValue}
        AND "deletedAt" IS NULL
    `
  }

  const objectFilter = location.objectId
    ? Prisma.sql`AND "objectId" = ${location.objectId}`
    : location.objectSlug
      ? Prisma.sql`AND "objectSlug" = ${location.objectSlug}`
      : Prisma.empty
  const deletedAtFilter = location.hasDeletedAt ? Prisma.sql`AND "deletedAt" IS NULL` : Prisma.empty

  if (args.attribute.isMulti) {
    return client.$executeRaw`
      UPDATE ${Prisma.raw(`"${location.tableName}"`)}
      SET ${Prisma.raw(`"${location.jsonColumn!}"`)} = jsonb_set(
        ${Prisma.raw(`"${location.jsonColumn!}"`)},
        ARRAY[${args.attribute.slug}],
        (
          SELECT jsonb_agg(
            CASE WHEN option_value = to_jsonb(${oldValue}::text) THEN to_jsonb(${newValue}::text) ELSE option_value END
          )
          FROM jsonb_array_elements(${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug}) AS option_values(option_value)
        )
      )
      WHERE "orgId" = ${orgId}
        ${objectFilter}
        AND ${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} ? ${oldValue}
        ${deletedAtFilter}
    `
  }

  return client.$executeRaw`
    UPDATE ${Prisma.raw(`"${location.tableName}"`)}
    SET ${Prisma.raw(`"${location.jsonColumn!}"`)} = jsonb_set(
      ${Prisma.raw(`"${location.jsonColumn!}"`)},
      ARRAY[${args.attribute.slug}],
      to_jsonb(${newValue}::text)
    )
    WHERE "orgId" = ${orgId}
      ${objectFilter}
      AND ${Prisma.raw(`"${location.jsonColumn!}"`)} ->> ${args.attribute.slug} = ${oldValue}
      ${deletedAtFilter}
  `
}

const addOptionSchema = z
  .object({
    value: z.string().trim().min(1, 'Each option needs a value.').max(64),
    label: z.string().trim().min(1, 'Each option needs a label.').max(100),
  })
  .strict()

const patchOptionSchema = z
  .object({
    label: z.string().trim().min(1, 'Each option needs a label.').max(100).optional(),
    color: z.enum(OPTION_COLOR_TOKENS).optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'Send at least one option field to update.' })

const renameOptionSchema = z
  .object({
    value: z.string().trim().min(1, 'Each option needs a value.').max(64),
  })
  .strict()

const removeOptionSchema = z
  .object({
    reassignTo: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/attributes — the org's fields, filterable by object
// ============================================================
// Pass ?objectId=... to read one object's fields (the field editor's call).
// Trashed rows are excluded; ordered by sortOrder then creation.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/attributes', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Build filters ---
    const objectId = blankToUndefined(req.query?.objectId) as string | undefined
    const where: Prisma.AttributeDefWhereInput = {
      orgId,
      deletedAt: null,
      ...(objectId ? { objectId } : {}),
    }

    // --- Execute query ---
    const attributes = await prisma.attributeDef.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    // --- Return response ---
    res.json({ attributes: attributes.map(mapAttributeToApi) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/attributes/:id — one field
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/attributes/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const attribute = await prisma.attributeDef.findFirst({
      where: { id, orgId, deletedAt: null },
    })
    if (!attribute) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    // --- Return response ---
    res.json({ attribute: mapAttributeToApi(attribute) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/attributes/:id/impact — delete confirmation summary
// ============================================================
router.get(
  '/:id/impact',
  wrapRoute('GET /api/orgs/:orgId/attributes/:id/impact', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Verify the field is in this org ---
    const attribute = await prisma.attributeDef.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { objectId: true, slug: true },
    })
    if (!attribute) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    // --- Execute query ---
    // Custom-record values are JSONB. The validator removes empty values, but this
    // query also excludes a legacy explicit empty string defensively.
    const [result] = await prisma.$queryRaw<{ valueCount: number }[]>`
      SELECT COUNT(*)::int AS "valueCount"
      FROM "Record"
      WHERE "orgId" = ${orgId}
        AND "objectId" = ${attribute.objectId}
        AND "deletedAt" IS NULL
        AND "valuesJson" ? ${attribute.slug}
        AND "valuesJson" ->> ${attribute.slug} <> ''
    `

    // --- Return response ---
    res.json({ valueCount: Number(result?.valueCount ?? 0) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/attributes — create a custom field (no migration!)
// ============================================================
// A user-created field is always isSystem=false and never storage="column": a
// real column needs a migration (spec §5.1). storage defaults to "custom" and may
// be "list", never "column". orgId comes from the path; the object must be in it.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/attributes', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = attributeBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    if (!body.objectId) {
      return void res.status(422).json({ error: 'A field needs an objectId.' })
    }
    if (!body.slug) {
      return void res.status(422).json({ error: 'A field needs a slug.' })
    }
    if (!body.name) {
      return void res.status(422).json({ error: 'A field needs a name.' })
    }
    if (!body.type) {
      return void res.status(422).json({ error: 'A field needs a type.' })
    }

    // --- Guard: a runtime field can never be a real column (spec §5.1) ---
    if (body.storage === 'column') {
      return void res.status(422).json({
        error: 'A custom field cannot be a table column — that needs a migration. Use custom or list.',
      })
    }

    // --- Verify the object is in this org ---
    const object = await prisma.objectDef.findFirst({
      where: { id: body.objectId, orgId, deletedAt: null },
      select: { id: true },
    })
    if (!object) {
      return void res.status(422).json({ error: 'The object was not found in this org.' })
    }

    // --- Verify a record_reference target is in this org ---
    if (body.refObjectId) {
      const ref = await prisma.objectDef.findFirst({
        where: { id: body.refObjectId, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!ref) {
        return void res.status(422).json({ error: 'The referenced object was not found in this org.' })
      }
    }

    // --- Execute query ---
    // isSystem is forced false: only the seed creates system/column fields.
    const data: Prisma.AttributeDefUncheckedCreateInput = {
      orgId,
      objectId: body.objectId,
      slug: body.slug,
      name: body.name,
      description: body.description,
      icon: body.icon,
      type: body.type,
      storage: body.storage ?? 'custom',
      isSystem: false,
      refObjectId: body.refObjectId,
      isIdentity: body.isIdentity ?? false,
      isMulti: body.isMulti ?? false,
      isRequired: body.isRequired ?? false,
      isUnique: body.isUnique ?? false,
      isReadOnly: body.isReadOnly ?? false,
      sortOrder: body.sortOrder ?? 0,
      ...(body.optionsJson ? { optionsJson: body.optionsJson as Prisma.InputJsonValue } : {}),
      ...(body.formatJson ? { formatJson: body.formatJson as Prisma.InputJsonValue } : {}),
      ...(body.validationJson ? { validationJson: body.validationJson as Prisma.InputJsonValue } : {}),
      ...(body.defaultJson ? { defaultJson: body.defaultJson as Prisma.InputJsonValue } : {}),
    }
    let created: AttributeDef
    try {
      created = await prisma.attributeDef.create({ data })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: DUPLICATE_SLUG_ERROR })
      }
      throw error
    }

    logger.info({ orgId, userId, attributeId: created.id }, 'created a custom field')

    // --- Return response ---
    res.status(201).json({ attribute: mapAttributeToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/attributes/:id — update a field
// ============================================================
// A system field can be renamed / re-described / hidden, but never RETYPED (spec
// §10.2): changing `type` (or `storage`) on an isSystem field is a 422. slug is
// the field's stable identity and is never patchable.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/attributes/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = attributeBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data
    const raw = (req.body ?? {}) as Record<string, unknown>

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.attributeDef.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    // --- Guard: a system field cannot be retyped (spec §10.2) ---
    // A retype is any change to `type` or `storage` — both would silently break the
    // code that reads the field. Rename/hide are fine and handled below.
    const retypingType = body.type !== undefined && body.type !== existing.type
    const retypingStorage = body.storage !== undefined && body.storage !== existing.storage
    if (existing.isSystem && (retypingType || retypingStorage)) {
      return void res
        .status(422)
        .json({ error: 'A system field cannot be retyped. Its name and visibility can change.' })
    }
    // A non-system field may not become a real column at runtime either (§5.1).
    if (body.storage === 'column' && existing.storage !== 'column') {
      return void res.status(422).json({
        error: 'A field cannot be moved to a table column — that needs a migration.',
      })
    }

    // --- Verify a new record_reference target is in this org ---
    if (body.refObjectId !== undefined) {
      const ref = await prisma.objectDef.findFirst({
        where: { id: body.refObjectId, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!ref) {
        return void res.status(422).json({ error: 'The referenced object was not found in this org.' })
      }
    }

    // --- Build the update, honoring "sent key" vs "absent key" ---
    const data: Record<string, unknown> = {}
    if ('name' in raw && body.name) data.name = body.name
    if ('description' in raw) data.description = blankToNull(raw.description) as string | null
    if ('icon' in raw) data.icon = blankToNull(raw.icon) as string | null
    if ('refObjectId' in raw) data.refObjectId = blankToNull(raw.refObjectId) as string | null
    // type/storage only reach here when unchanged for a system field, or on a
    // non-system field (a legitimate retype of a custom field).
    if (body.type !== undefined) data.type = body.type
    if (body.storage !== undefined) data.storage = body.storage
    if (body.isIdentity !== undefined) data.isIdentity = body.isIdentity
    if (body.isMulti !== undefined) data.isMulti = body.isMulti
    if (body.isRequired !== undefined) data.isRequired = body.isRequired
    if (body.isUnique !== undefined) data.isUnique = body.isUnique
    if (body.isReadOnly !== undefined) data.isReadOnly = body.isReadOnly
    if (body.isArchived !== undefined) data.isArchived = body.isArchived
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder
    if ('optionsJson' in raw && body.optionsJson) data.optionsJson = body.optionsJson
    if ('formatJson' in raw && body.formatJson) data.formatJson = body.formatJson
    if ('validationJson' in raw && body.validationJson) data.validationJson = body.validationJson
    if ('defaultJson' in raw && body.defaultJson) data.defaultJson = body.defaultJson

    // --- Execute query ---
    let count: number
    try {
      const result = await prisma.attributeDef.updateMany({
        where: { id, orgId, deletedAt: null },
        data,
      })
      count = result.count
    } catch (error) {
      if (isUniqueViolation(error)) {
        return void res.status(409).json({ error: DUPLICATE_SLUG_ERROR })
      }
      throw error
    }
    if (count === 0) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    logger.info({ orgId, userId, attributeId: id }, 'updated a field')

    // --- Return response ---
    const updated = await prisma.attributeDef.findFirst({ where: { id, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    res.json({ attribute: mapAttributeToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/attributes/:id — soft-delete a custom field
// ============================================================
// A system field can never be deleted, only hidden (spec §10.2) — a 422, because
// the field is real, the action is what is refused. A custom field soft-deletes.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/attributes/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Load the current row to check the system-field guard ---
    const existing = await prisma.attributeDef.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    if (existing.isSystem) {
      return void res
        .status(422)
        .json({ error: 'A system field cannot be deleted. Hide it instead.' })
    }

    // --- Execute query ---
    const result = await prisma.attributeDef.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    logger.info({ orgId, userId, attributeId: id }, 'trashed a custom field')

    // --- Return response ---
    res.status(204).send()
  }),
)

// ============================================================
// POST /api/orgs/:orgId/attributes/:id/options — add an option
// ============================================================
// A new option gets the next muted token automatically (journey 4b.5.1). The
// caller supplies value + label; color is assigned, never trusted from the body.
router.post(
  '/:id/options',
  wrapRoute('POST /api/orgs/:orgId/attributes/:id/options', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = addOptionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Load the field (org-scoped) ---
    const loaded = await loadAttributeWithObject(orgId, id)
    if (!loaded) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    const { attribute } = loaded
    if (!OPTION_TYPES.has(attribute.type)) {
      return void res.status(422).json({ error: 'This field does not have options.' })
    }

    const options = readOptions(attribute)
    if (options.some((option) => option.value === parsed.data.value)) {
      return void res.status(409).json({ error: 'An option already uses this value.' })
    }

    // --- Execute query ---
    const nextOptions = [
      ...options,
      { value: parsed.data.value, label: parsed.data.label, color: nextOptionToken(options), order: options.length, isArchived: false },
    ]
    const result = await prisma.attributeDef.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { optionsJson: nextOptions as unknown as Prisma.InputJsonValue },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    logger.info({ orgId, userId, attributeId: id, optionValue: parsed.data.value }, 'added a field option')

    // --- Return response ---
    const updated = await prisma.attributeDef.findFirst({ where: { id, orgId } })
    if (!updated) return void res.status(404).json({ error: 'Field not found' })
    res.status(201).json({ attribute: mapAttributeToApi(updated) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/attributes/:id/options/:value — relabel / recolor / archive / restore
// ============================================================
// Relabel and recolor are cosmetic and safe. isArchived=true archives (hides from
// new choice, keeps historic rendering); isArchived=false restores it.
router.patch(
  '/:id/options/:value',
  wrapRoute('PATCH /api/orgs/:orgId/attributes/:id/options/:value', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const value = String(req.params.value)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = patchOptionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Load the field (org-scoped) ---
    const loaded = await loadAttributeWithObject(orgId, id)
    if (!loaded) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    const { attribute } = loaded
    const options = readOptions(attribute)
    const index = options.findIndex((option) => option.value === value)
    if (index === -1) {
      return void res.status(404).json({ error: 'Option not found' })
    }

    // --- Execute query ---
    const nextOptions = [...options]
    nextOptions[index] = { ...nextOptions[index], ...parsed.data }
    const result = await prisma.attributeDef.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { optionsJson: nextOptions as unknown as Prisma.InputJsonValue },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Field not found' })
    }

    logger.info({ orgId, userId, attributeId: id, optionValue: value }, 'updated a field option')

    // --- Return response ---
    const updated = await prisma.attributeDef.findFirst({ where: { id, orgId } })
    if (!updated) return void res.status(404).json({ error: 'Field not found' })
    res.json({ attribute: mapAttributeToApi(updated) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/attributes/:id/options/:value/impact — rename/remove warning count
// ============================================================
router.get(
  '/:id/options/:value/impact',
  wrapRoute('GET /api/orgs/:orgId/attributes/:id/options/:value/impact', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const value = String(req.params.value)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Load the field (org-scoped) ---
    const loaded = await loadAttributeWithObject(orgId, id)
    if (!loaded) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    const { attribute, object } = loaded
    if (!readOptions(attribute).some((option) => option.value === value)) {
      return void res.status(404).json({ error: 'Option not found' })
    }

    // --- Execute query ---
    const valueCount = await countOptionValue(prisma, { orgId, object, attribute, value })

    // --- Return response ---
    res.json({ valueCount })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/attributes/:id/options/:value/rename — change the stored value
// ============================================================
// Changing the stored value is guarded: it migrates every record from the old
// value to the new in ONE transaction, and returns the count so the caller can
// surface the warning (journey 4b.5.3).
router.post(
  '/:id/options/:value/rename',
  wrapRoute('POST /api/orgs/:orgId/attributes/:id/options/:value/rename', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const oldValue = String(req.params.value)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = renameOptionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const newValue = parsed.data.value
    if (newValue === oldValue) {
      return void res.status(422).json({ error: 'The new value is the same as the current one.' })
    }

    // --- Load the field (org-scoped) ---
    const loaded = await loadAttributeWithObject(orgId, id)
    if (!loaded) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    const { attribute, object } = loaded
    const options = readOptions(attribute)
    const index = options.findIndex((option) => option.value === oldValue)
    if (index === -1) {
      return void res.status(404).json({ error: 'Option not found' })
    }
    if (options.some((option) => option.value === newValue)) {
      return void res.status(409).json({ error: 'An option already uses this value.' })
    }

    // --- Execute query (atomic: migrate records + rewrite the option) ---
    const nextOptions = [...options]
    nextOptions[index] = { ...nextOptions[index], value: newValue }
    const valueCount = await prisma.$transaction(async (tx) => {
      const migrated = await migrateOptionValue(tx, { orgId, object, attribute, oldValue, newValue })
      await tx.attributeDef.updateMany({
        where: { id, orgId, deletedAt: null },
        data: { optionsJson: nextOptions as unknown as Prisma.InputJsonValue },
      })
      return migrated
    })

    logger.info({ orgId, userId, attributeId: id, oldValue, newValue, valueCount }, 'renamed a field option value')

    // --- Return response ---
    const updated = await prisma.attributeDef.findFirst({ where: { id, orgId } })
    if (!updated) return void res.status(404).json({ error: 'Field not found' })
    res.json({ attribute: mapAttributeToApi(updated), valueCount })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/attributes/:id/options/:value — reassign & remove
// ============================================================
// Removing an option that records use is guarded: pass `reassignTo` to move those
// records to another option first, then the option is removed. Without a
// reassignTo, records keep the orphaned value (the option simply leaves the list).
router.delete(
  '/:id/options/:value',
  wrapRoute('DELETE /api/orgs/:orgId/attributes/:id/options/:value', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const value = String(req.params.value)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = removeOptionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const reassignTo = parsed.data.reassignTo

    // --- Load the field (org-scoped) ---
    const loaded = await loadAttributeWithObject(orgId, id)
    if (!loaded) {
      return void res.status(404).json({ error: 'Field not found' })
    }
    const { attribute, object } = loaded
    const options = readOptions(attribute)
    const index = options.findIndex((option) => option.value === value)
    if (index === -1) {
      return void res.status(404).json({ error: 'Option not found' })
    }
    if (reassignTo !== undefined && !options.some((option) => option.value === reassignTo)) {
      return void res.status(422).json({ error: 'The reassign target is not an option on this field.' })
    }

    // --- Execute query (atomic: reassign records, then remove the option) ---
    const nextOptions = options.filter((option) => option.value !== value)
    await prisma.$transaction(async (tx) => {
      if (reassignTo !== undefined) {
        await migrateOptionValue(tx, { orgId, object, attribute, oldValue: value, newValue: reassignTo })
      }
      await tx.attributeDef.updateMany({
        where: { id, orgId, deletedAt: null },
        data: { optionsJson: nextOptions as unknown as Prisma.InputJsonValue },
      })
    })

    logger.info({ orgId, userId, attributeId: id, optionValue: value, reassignTo }, 'removed a field option')

    // --- Return response ---
    const updated = await prisma.attributeDef.findFirst({ where: { id, orgId } })
    if (!updated) return void res.status(404).json({ error: 'Field not found' })
    res.json({ attribute: mapAttributeToApi(updated) })
  }),
)

export default router
