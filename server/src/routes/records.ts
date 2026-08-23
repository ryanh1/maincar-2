/**
 * Record routes — rows of user-invented (custom) objects (MAI-135, T7; spec §5.1,
 * §5.14). A custom ObjectDef has storage="record"; its rows live in the Record
 * table with every field packed into valuesJson, keyed by AttributeDef slug.
 *
 * Mounted at /api/orgs/:orgId/records. The org lives in the path, never the caller's
 * currentOrgId. Every route requires auth and an active membership in that org, and
 * every read AND write carries the orgId filter (findFirst/updateMany with orgId,
 * never by id alone) — .claude/rules/database-and-prisma.md.
 *
 * The rules the database cannot enforce on a schemaless JSONB column, and therefore
 * live here, all funnel through ONE place — validateRecordValues (spec §5.11):
 *   - a value matches its AttributeDef's type;
 *   - a required field is present after the write;
 *   - a unique field's value is not already used by another record;
 *   - a cleared value is stored absent, never "".
 * There are NO ad-hoc valuesJson writes anywhere else (plan T7 risk).
 *
 * A record_reference field also writes a RecordLink row so the reference resolves as
 * a graph edge (spec §5.4); table-backed targets (person/company/...) keep their own
 * real foreign keys and are not re-checked here.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { activityFromRecordCreated, recordActivityInTx } from '../crm/activityFeed.js'
import { rollUpSpineLinks } from '../crm/taskNote.js'
import {
  validateRecordValues,
  type ValidatorAttribute,
  type RecordValues,
} from '../crm/valuesValidator.js'
import { diffFieldValues, recordFieldHistoryInTx } from '../crm/fieldHistory.js'
import { filterRecordsByContainment } from '../crm/recordFilter.js'
import type { AttributeDef, Prisma, Record as RecordRow } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

// --- Mapper: database row → API shape ---
// orgId and deletedAt are internal and not exposed.
function mapRecordToApi(
  record: Pick<
    RecordRow,
    'id' | 'objectId' | 'valuesJson' | 'isArchived' | 'createdAt' | 'updatedAt'
  >,
  links?: { attribute: string | null; toObject: string; toId: string; isArchived?: boolean }[],
) {
  return {
    id: record.id,
    objectId: record.objectId,
    values: record.valuesJson,
    isArchived: record.isArchived,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(links ? { links } : {}),
  }
}

// The body for create/update. `values` is an arbitrary JSON object; its shape is
// validated against the object's AttributeDefs, not here.
const valuesSchema = z.record(z.string(), z.unknown())
const createBodySchema = z.object({
  objectId: z.string().min(1),
  values: valuesSchema.optional(),
})
const updateBodySchema = z.object({
  values: valuesSchema.optional(),
  isArchived: z.boolean().optional(),
})

const includeArchivedQuery = (value: unknown): boolean => value === 'true'

// The active attributes that live in valuesJson for an object: not deleted, not
// archived, and not list-scoped (those belong to ListEntry). These are what the
// validator keys on.
async function loadValueAttributes(orgId: string, objectId: string): Promise<AttributeDef[]> {
  return prisma.attributeDef.findMany({
    where: { orgId, objectId, deletedAt: null, isArchived: false, storage: { not: 'list' } },
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
    validationJson: attr.validationJson ?? undefined,
  }
}

// Build the uniqueness checker the validator calls: another non-deleted record of
// the same object whose valuesJson contains { slug: value }, excluding this row.
// Uses the SAME GIN containment path as the filter route.
function makeUniquenessChecker(orgId: string, objectId: string, excludeId: string | null) {
  return async (attr: ValidatorAttribute, value: unknown): Promise<boolean> => {
    const rows = await filterRecordsByContainment(prisma, {
      orgId,
      objectId,
      match: { [attr.slug]: value },
      limit: 2,
    })
    return rows.some((r) => r.id !== excludeId)
  }
}

// Resolve the target ObjectDef (slug + storage) for every record_reference attribute
// that has a value, so a RecordLink can name the target object by slug and a
// record-backed target's existence can be verified.
async function resolveRefTargets(
  orgId: string,
  attributes: AttributeDef[],
  values: RecordValues,
): Promise<Map<string, { slug: string; storage: string }>> {
  const refObjectIds = new Set<string>()
  for (const attr of attributes) {
    if (attr.type === 'record_reference' && attr.refObjectId && values[attr.slug] !== undefined) {
      refObjectIds.add(attr.refObjectId)
    }
  }
  if (refObjectIds.size === 0) return new Map()
  const objects = await prisma.objectDef.findMany({
    where: { orgId, id: { in: [...refObjectIds] }, deletedAt: null },
    select: { id: true, slug: true, storage: true },
  })
  return new Map(objects.map((o) => [o.id, { slug: o.slug, storage: o.storage }]))
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/records?objectId=...&match=... — list / filter
// ============================================================
// objectId is required (records are only meaningful within one object). Pass
// ?match=<url-encoded JSON of { slug: value }> to filter on valuesJson through the
// GIN index (containment). Trashed rows are excluded.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/records', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const objectId = typeof req.query?.objectId === 'string' ? req.query.objectId : ''
    const includeArchived = includeArchivedQuery(req.query?.includeArchived)
    if (!objectId) {
      return void res.status(400).json({ error: 'An objectId query param is required.' })
    }

    let match: Record<string, unknown> | null = null
    if (typeof req.query?.match === 'string' && req.query.match.trim() !== '') {
      try {
        const parsed = JSON.parse(req.query.match)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return void res.status(400).json({ error: 'match must be a JSON object of { slug: value }.' })
        }
        match = parsed as Record<string, unknown>
      } catch {
        return void res.status(400).json({ error: 'match must be valid JSON.' })
      }
    }

    // --- Execute query ---
    if (match) {
      // GIN-indexed containment filter (spec §5.1) — the raw @> path.
      const rows = await filterRecordsByContainment(prisma, { orgId, objectId, match, ...(includeArchived ? { includeArchived: true } : {}) })
      return void res.json({ records: rows.map((r) => mapRecordToApi(r)) })
    }

    const records = await prisma.record.findMany({
      where: { orgId, objectId, deletedAt: null, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ createdAt: 'desc' }],
    })
    res.json({ records: records.map((r) => mapRecordToApi(r)) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/records/:id — one record, with its outgoing links
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/records/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const record = await prisma.record.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!record) {
      return void res.status(404).json({ error: 'Record not found' })
    }
    // Resolve outgoing references (spec §5.4).
    const links = await prisma.recordLink.findMany({
      where: { orgId, fromObject: 'record', fromId: id },
      select: { attribute: true, toObject: true, toId: true },
    })
    const resolvedLinks = await addArchivedLinkState(orgId, links)

    // --- Return response ---
    res.json({ record: mapRecordToApi(record, resolvedLinks) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/records/:id/duplicate — duplicate a custom record
// ============================================================
// Duplicates preserve ordinary values and RecordLink references, but unique and
// contact-channel fields are intentionally blank so the copy is safe to edit.
// This is a create-like action, not an edit, so it writes no activity or history.
router.post(
  '/:id/duplicate',
  wrapRoute('POST /api/orgs/:orgId/records/:id/duplicate', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const source = await prisma.record.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!source) return void res.status(404).json({ error: 'Record not found' })

    const attributes = await prisma.attributeDef.findMany({
      where: { orgId, objectId: source.objectId, deletedAt: null, storage: { not: 'list' } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const values = { ...((source.valuesJson ?? {}) as RecordValues) }
    for (const attribute of attributes) {
      if (attribute.isUnique || attribute.type === 'email' || attribute.type === 'phone') delete values[attribute.slug]
    }

    // --- Verify ownership of copied references ---
    const refTargets = await resolveRefTargets(orgId, attributes, values)
    const missingRef = await verifyReferenceTargets(orgId, attributes, values, refTargets)
    if (missingRef) return void res.status(422).json({ error: missingRef })

    const duplicate = await prisma.$transaction(async (tx) => {
      const created = await tx.record.create({
        data: { orgId, objectId: source.objectId, valuesJson: values as Prisma.InputJsonValue },
      })
      await syncRecordLinks(tx, orgId, created.id, attributes, values, refTargets)
      return created
    })

    logger.info({ orgId, userId, sourceRecordId: id, recordId: duplicate.id }, 'duplicated a custom record')
    res.status(201).json({ record: mapRecordToApi(duplicate) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/records — create a record of a custom object
// ============================================================
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/records', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = createBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { objectId, values: input = {} } = parsed.data

    // --- Verify the object is a custom (record-backed) object in this org ---
    const object = await prisma.objectDef.findFirst({
      where: { id: objectId, orgId, deletedAt: null },
      select: { id: true, slug: true, name: true, storage: true, timelineEventsEnabled: true },
    })
    if (!object) {
      return void res.status(422).json({ error: 'The object was not found in this org.' })
    }
    if (object.storage !== 'record') {
      return void res.status(422).json({
        error: 'This object is table-backed; use its own route, not the generic records route.',
      })
    }

    // --- Validate the values through the ONE validator ---
    const attributes = await loadValueAttributes(orgId, objectId)
    const result = await validateRecordValues({
      attributes: attributes.map(toValidatorAttribute),
      input,
      mode: 'create',
      checkUnique: makeUniquenessChecker(orgId, objectId, null),
    })
    if (!result.ok) {
      return void res.status(422).json({ error: result.error })
    }

    // --- Resolve + verify record_reference targets, then write atomically ---
    const refTargets = await resolveRefTargets(orgId, attributes, result.values)
    const missingRef = await verifyReferenceTargets(orgId, attributes, result.values, refTargets)
    if (missingRef) {
      return void res.status(422).json({ error: missingRef })
    }

    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.record.create({
        data: { orgId, objectId, valuesJson: result.values as Prisma.InputJsonValue },
      })
      await syncRecordLinks(tx, orgId, record.id, attributes, result.values, refTargets)
      if (object.timelineEventsEnabled) {
        const links = await tx.recordLink.findMany({
          where: { orgId, fromObject: 'record', fromId: record.id },
          select: { toObject: true, toId: true },
        })
        await recordActivityInTx(
          tx,
          activityFromRecordCreated(record, {
            kind: 'custom',
            name: object.name,
            links: rollUpSpineLinks(links.map((link) => ({ object: link.toObject, id: link.toId }))),
            actorUserId: userId,
          }),
        )
      }
      return record
    })

    logger.info({ orgId, userId, recordId: created.id, objectId }, 'created a custom record')

    // --- Return response ---
    res.status(201).json({ record: mapRecordToApi(created) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/records/:id — update a record's values / archive
// ============================================================
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/records/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = updateBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const body = parsed.data

    // --- Load the current row (org-scoped) ---
    const existing = await prisma.record.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Record not found' })
    }

    // --- Validate merged values through the ONE validator (when values change) ---
    const attributes = await loadValueAttributes(orgId, existing.objectId)
    let nextValues = existing.valuesJson as RecordValues
    if (body.values !== undefined) {
      const result = await validateRecordValues({
        attributes: attributes.map(toValidatorAttribute),
        input: body.values,
        mode: 'update',
        current: (existing.valuesJson ?? {}) as RecordValues,
        checkUnique: makeUniquenessChecker(orgId, existing.objectId, id),
      })
      if (!result.ok) {
        return void res.status(422).json({ error: result.error })
      }
      nextValues = result.values
    }

    // --- Resolve + verify any changed record_reference targets ---
    const refTargets = await resolveRefTargets(orgId, attributes, nextValues)
    const missingRef = await verifyReferenceTargets(orgId, attributes, nextValues, refTargets)
    if (missingRef) {
      return void res.status(422).json({ error: missingRef })
    }

    // --- The object's slug, for the history rows (org-scoped) ---
    const objectDef = await prisma.objectDef.findFirst({
      where: { id: existing.objectId, orgId },
      select: { slug: true },
    })

    // --- Execute the write atomically ---
    // The FieldHistory rows are written in this SAME transaction as the value change
    // (spec §5.7, MAI-136): both commit or both roll back, so a value and its history
    // can never disagree. History is append-only and is never read back as the
    // current value — that stays the plain valuesJson read below.
    await prisma.$transaction(async (tx) => {
      const data: Prisma.RecordUpdateManyMutationInput = {}
      if (body.values !== undefined) data.valuesJson = nextValues as Prisma.InputJsonValue
      if (body.isArchived !== undefined) data.isArchived = body.isArchived
      const result = await tx.record.updateMany({ where: { id, orgId, deletedAt: null }, data })
      if (result.count === 0) throw new Error('record vanished mid-update')
      if (body.values !== undefined) {
        await syncRecordLinks(tx, orgId, id, attributes, nextValues, refTargets)

        // `full` mode: valuesJson is the whole post-write bag, and a cleared field is
        // stored ABSENT (§5.14), so a key that vanished is a change to null.
        const changes = diffFieldValues(
          (existing.valuesJson ?? {}) as RecordValues,
          nextValues,
          { mode: 'full' },
        )
        await recordFieldHistoryInTx(tx, {
          orgId,
          objectSlug: objectDef?.slug ?? existing.objectId,
          recordId: id,
          changes,
          changeSource: 'user',
          changedByUserId: userId,
          // The attributes are already loaded, so the shape check costs no extra query.
          attributes: attributes.map(toValidatorAttribute),
        })
      }
    })

    logger.info({ orgId, userId, recordId: id }, 'updated a custom record')

    // --- Return response ---
    const updated = await prisma.record.findFirst({ where: { id, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Record not found' })
    }
    res.json({ record: mapRecordToApi(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/records/:id — soft-delete into the 30-day trash
// ============================================================
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/records/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.record.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Record not found' })
    }

    logger.info({ orgId, userId, recordId: id }, 'trashed a custom record')

    // --- Return response ---
    res.status(204).send()
  }),
)

// --- record_reference helpers -------------------------------------------------

// For a record-backed reference target, verify the pointed-at Record exists in the
// org — the closest we get to a foreign key on a generic edge. Table-backed targets
// (person/company/...) keep real FKs elsewhere and are not re-checked. Returns an
// error string, or null when every reference is fine.
async function verifyReferenceTargets(
  orgId: string,
  attributes: AttributeDef[],
  values: RecordValues,
  refTargets: Map<string, { slug: string; storage: string }>,
): Promise<string | null> {
  for (const attr of attributes) {
    if (attr.type !== 'record_reference' || !attr.refObjectId) continue
    const value = values[attr.slug]
    if (value === undefined) continue
    const target = refTargets.get(attr.refObjectId)
    if (!target || target.storage !== 'record') continue // only verify record-backed targets
    const ids = Array.isArray(value) ? value : [value]
    for (const targetId of ids) {
      if (typeof targetId !== 'string') continue
      const exists = await prisma.record.findFirst({
        where: { id: targetId, orgId, objectId: attr.refObjectId, deletedAt: null },
        select: { id: true },
      })
      if (!exists) {
        return `${attr.name} points at a ${target.slug} that does not exist.`
      }
    }
  }
  return null
}

// Rewrite the RecordLink edges for this record's record_reference fields: for each
// such field present in the values, drop its old links and insert the current ones.
// A field that is now absent has its links removed (they were deleted and none are
// re-created). Runs inside the caller's transaction so links and values agree.
async function syncRecordLinks(
  tx: Prisma.TransactionClient,
  orgId: string,
  recordId: string,
  attributes: AttributeDef[],
  values: RecordValues,
  refTargets: Map<string, { slug: string; storage: string }>,
): Promise<void> {
  const refAttrs = attributes.filter((a) => a.type === 'record_reference' && a.refObjectId)
  for (const attr of refAttrs) {
    await tx.recordLink.deleteMany({
      where: { orgId, fromObject: 'record', fromId: recordId, attribute: attr.slug },
    })
    const value = values[attr.slug]
    if (value === undefined) continue
    const target = refTargets.get(attr.refObjectId!)
    const toObject = target?.slug ?? 'unknown'
    const ids = Array.isArray(value) ? value : [value]
    for (const toId of ids) {
      if (typeof toId !== 'string') continue
      await tx.recordLink.create({
        data: {
          orgId,
          fromObject: 'record',
          fromId: recordId,
          attribute: attr.slug,
          toObject,
          toId,
        },
      })
    }
  }
}

/** Adds lifecycle state to custom-record links while preserving links to active table records. */
async function addArchivedLinkState(
  orgId: string,
  links: { attribute: string | null; toObject: string; toId: string }[],
): Promise<{ attribute: string | null; toObject: string; toId: string; isArchived?: boolean }[]> {
  const slugs = [...new Set(links.map((link) => link.toObject))]
  if (slugs.length === 0) return links

  const targetObjects = await prisma.objectDef.findMany({
    where: { orgId, slug: { in: slugs }, storage: 'record', deletedAt: null },
    select: { id: true, slug: true },
  })
  if (targetObjects.length === 0) return links

  const targetIds = links.map((link) => link.toId)
  const targetRecords = await prisma.record.findMany({
    where: { orgId, objectId: { in: targetObjects.map((object) => object.id) }, id: { in: targetIds }, deletedAt: null },
    select: { id: true, isArchived: true },
  })
  const states = new Map(targetRecords.map((record) => [record.id, record.isArchived]))
  return links.map((link) => {
    const isArchived = states.get(link.toId)
    return isArchived === undefined ? link : { ...link, isArchived }
  })
}

export default router
