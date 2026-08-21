/**
 * Note routes — the org's written memory (MAI-141 T13; spec §6, plan T13).
 *
 * Mounted at /api/orgs/:orgId/notes. The org lives in the path, never the caller's
 * `currentOrgId`. Every route requires auth and an active membership in the org
 * named by the path, and every read AND write carries the orgId filter —
 * `findFirst`/`updateMany` with orgId, never by id alone
 * (.claude/rules/database-and-prisma.md).
 *
 * FOUR RULES THIS FILE HOLDS TO:
 *
 *   1. A NOTE ATTACHES TO MANY RECORDS, through `RecordLink` — the seam T7 put
 *      there — and never through columns on Note. That is the T13 acceptance
 *      criterion, and it is also why Note has no personId/companyId/dealId: a
 *      nullable triple can hold exactly one of each, so it would cap the thing the
 *      model exists to make possible. There is no parallel link table.
 *   2. `bodyText` IS DERIVED, NEVER SUPPLIED. Every write flattens `bodyJson`
 *      through `flattenTipTapText` (server/src/crm/taskNote.ts), so the searchable
 *      text and the rendered document cannot describe different notes. A client
 *      cannot send its own `bodyText`; the field is not in the body schema at all.
 *   3. THE FEED ROW IS ATOMIC WITH THE NOTE. A note IS an activity (spec §6 lists
 *      `note` in `ActivityEntry.sourceType`), so every create and every edit writes
 *      its one feed row inside the SAME transaction, through `recordActivityInTx`
 *      — which takes a transaction client and nothing else, so doing it outside is
 *      a type error rather than a review catch. Trashing a note removes its feed
 *      row in that same transaction: a cache that outlives the row it caches is
 *      worse than no cache, because it is believed.
 *   4. THE AUTHOR IS THE VERIFIED CALLER. `authorUserId` is never read off the
 *      body — a note is a claim about who said something.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { activityFromNote, recordActivityInTx } from '../crm/activityFeed.js'
import {
  flattenTipTapText,
  mapLinksToApi,
  mapNoteToApi,
  rollUpSpineLinks,
  type LinkTarget,
} from '../crm/taskNote.js'
import {
  MAX_LINKS_PER_WORK_ITEM,
  dedupeLinkTargets,
  idsLinkedToRecord,
  loadWorkLinks,
  syncWorkLinks,
  verifyLinkTargets,
} from '../crm/workLinks.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100

const SORT_FIELDS = ['createdAt', 'updatedAt'] as const

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

const linkTargetSchema = z.object({
  object: z.string().trim().min(1).max(60),
  id: z.string().trim().min(1),
})

const linksSchema = z
  .array(linkTargetSchema)
  .max(MAX_LINKS_PER_WORK_ITEM, `A note can be attached to at most ${MAX_LINKS_PER_WORK_ITEM} records.`)

// A TipTap document is an object, not an array and not a scalar. Its INTERNAL
// shape is deliberately not validated: the editor gains node types over time, and
// a server that rejected an unfamiliar one would make a client upgrade a breaking
// change. `flattenTipTapText` walks whatever arrives and takes the text out of it.
const bodyJsonSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'bodyJson must be a TipTap document object.' },
)

const createBodySchema = z.object({
  bodyJson: bodyJsonSchema,
  links: linksSchema.optional(),
})

// `bodyText` is absent on purpose — see rule 2 in the module header.
const updateBodySchema = z.object({
  bodyJson: bodyJsonSchema.optional(),
  links: linksSchema.optional(),
})

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

  authorUserId: optionalId,

  // "The notes on this record" — both halves required together.
  linkObject: z.preprocess(blankToUndefined, z.string().trim().min(1).max(60).optional()),
  linkId: optionalId,

  // Free text over the FLATTENED body, which is the entire reason bodyText is a
  // column: searching a JSONB document tree for a phrase is a query nobody wants
  // to write twice.
  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

/**
 * Writes the note's ONE feed row inside the caller's transaction.
 *
 * Pulled out because create and update both do it and must do it identically — a
 * feed line that only refreshes on create would leave the feed quoting the first
 * draft of an edited note forever. The upsert on (orgId, sourceType, sourceId)
 * means the second call refreshes rather than appends.
 */
async function writeNoteFeedRow(
  tx: Prisma.TransactionClient,
  note: { id: string; orgId: string; bodyText: string; authorUserId: string | null; createdAt: Date },
  targets: LinkTarget[],
): Promise<void> {
  // A feed row lands on ONE account page, so it carries at most one company,
  // person, and deal out of however many the note is attached to. The links stay
  // the truth; this is the cache (server/src/crm/activityFeed.ts).
  await recordActivityInTx(tx, activityFromNote(note, rollUpSpineLinks(targets)))
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/notes — the org's notes
// ============================================================
// Paginated, sortable, and filterable by author, attached record, and free text
// over the flattened body. Trashed rows are excluded. The count and the page are
// read against the SAME where clause.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/notes', async (req, res) => {
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
    const { page, limit, sort, dir, authorUserId, linkObject, linkId, q } = parsed.data

    if ((linkObject === undefined) !== (linkId === undefined)) {
      return void res
        .status(400)
        .json({ error: 'Filtering by attachment needs both linkObject and linkId.' })
    }

    // --- Build filters ---
    // An empty attachment result stays an EMPTY page, never an unfiltered one.
    let linkedIds: string[] | null = null
    if (linkObject && linkId) {
      linkedIds = await idsLinkedToRecord(prisma, {
        orgId,
        source: 'note',
        target: { object: linkObject, id: linkId },
      })
    }

    const where: Prisma.NoteWhereInput = {
      orgId,
      deletedAt: null,
      ...(linkedIds ? { id: { in: linkedIds } } : {}),
      ...(authorUserId ? { authorUserId } : {}),
      ...(q ? { bodyText: { contains: q, mode: 'insensitive' as const } } : {}),
    }

    // --- Execute query ---
    const orderBy: Prisma.NoteOrderByWithRelationInput[] =
      sort === 'createdAt' ? [{ createdAt: dir }] : [{ [sort]: dir }, { createdAt: 'desc' as const }]

    const [total, notes] = await Promise.all([
      prisma.note.count({ where }),
      prisma.note.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        // The attachments ride along: "this note is about Acme and Jane" is what a
        // note row renders, and fetching it per row is the N+1 this avoids.
        include: { links: { select: { toObject: true, toId: true } } },
      }),
    ])

    // --- Return response ---
    res.json({ notes: notes.map((note) => mapNoteToApi(note)), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/notes/:id — one note, with every record it is attached to
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/notes/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const note = await prisma.note.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!note) {
      return void res.status(404).json({ error: 'Note not found' })
    }
    const links = await loadWorkLinks(prisma, { orgId, source: 'note', sourceId: id })

    // --- Return response ---
    res.json({ note: { ...mapNoteToApi(note), links: mapLinksToApi(links) } })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/notes — write a note and attach it to records
// ============================================================
// The T13 acceptance criterion lives here: `links` may name MANY records, and each
// becomes a RecordLink row. The note, its links, and its feed row all commit in one
// transaction.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/notes', async (req, res) => {
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
    const targets = dedupeLinkTargets(parsed.data.links ?? [])

    // --- Verify every attachment target exists in this org ---
    const badTarget = await verifyLinkTargets(prisma, orgId, targets)
    if (badTarget) {
      return void res.status(422).json({ error: badTarget })
    }

    // The one flattening (rule 2), done BEFORE the write so the two columns land
    // together and cannot be derived from different inputs.
    const bodyJson = parsed.data.bodyJson
    const bodyText = flattenTipTapText(bodyJson)

    // --- Execute the write atomically ---
    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          // orgId from the PATH and the author from the VERIFIED CALLER — neither
          // is read off the body (rule 4).
          orgId,
          authorUserId: userId,
          bodyJson: bodyJson as Prisma.InputJsonValue,
          bodyText,
        },
      })
      await syncWorkLinks(tx, { orgId, source: 'note', sourceId: note.id, targets })
      // The feed row, in THIS transaction (rule 3). A note that rolls back cannot
      // leave a feed line claiming it was written.
      await writeNoteFeedRow(tx, note, targets)
      return note
    })

    logger.info({ orgId, userId, noteId: created.id, links: targets.length }, 'created a note')

    // --- Return response ---
    res.status(201).json({ note: { ...mapNoteToApi(created), links: targets } })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/notes/:id — edit the body, or re-attach it
// ============================================================
// `links`, when present, REPLACES the whole attachment set; a PATCH that omits it
// leaves the attachments alone. Either change refreshes the feed row, because both
// change what the feed should say.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/notes/:id', async (req, res) => {
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
    const existing = await prisma.note.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Note not found' })
    }

    const targets = body.links === undefined ? null : dedupeLinkTargets(body.links)
    if (targets) {
      const badTarget = await verifyLinkTargets(prisma, orgId, targets)
      if (badTarget) {
        return void res.status(422).json({ error: badTarget })
      }
    }

    // Re-flattened from the NEW document, through the same one function.
    const nextBodyText =
      body.bodyJson === undefined ? existing.bodyText : flattenTipTapText(body.bodyJson)

    // --- Execute the write atomically ---
    await prisma.$transaction(async (tx) => {
      if (body.bodyJson !== undefined) {
        const result = await tx.note.updateMany({
          where: { id, orgId, deletedAt: null },
          // Both columns, always together (rule 2).
          data: { bodyJson: body.bodyJson as Prisma.InputJsonValue, bodyText: nextBodyText },
        })
        if (result.count === 0) throw new Error('note vanished mid-update')
      }
      if (targets) {
        await syncWorkLinks(tx, { orgId, source: 'note', sourceId: id, targets })
      }

      // Refresh the ONE feed row so the line the feed renders is the note as it
      // now reads, and lands on the account it is now attached to. The upsert
      // refreshes rather than appends. `createdAt` is the note's, not now: the
      // feed places a note when it was WRITTEN, and editing it must not jump it to
      // the top of a history.
      const feedTargets =
        targets ?? (await loadWorkLinks(tx, { orgId, source: 'note', sourceId: id })).map(
          (link) => ({ object: link.toObject, id: link.toId }),
        )
      await writeNoteFeedRow(
        tx,
        {
          id,
          orgId,
          bodyText: nextBodyText,
          authorUserId: existing.authorUserId,
          createdAt: existing.createdAt,
        },
        feedTargets,
      )
    })

    logger.info({ orgId, userId, noteId: id }, 'updated a note')

    // --- Return response ---
    const updated = await prisma.note.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!updated) {
      return void res.status(404).json({ error: 'Note not found' })
    }
    const links = await loadWorkLinks(prisma, { orgId, source: 'note', sourceId: id })
    res.json({ note: { ...mapNoteToApi(updated), links: mapLinksToApi(links) } })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/notes/:id — soft-delete into the 30-day trash
// ============================================================
// The note row and its links stay, so a restore restores what it was about. The
// FEED ROW GOES, in the same transaction: the feed is a cache of what happened and
// is read without a join back, so a line for a trashed note would be a line
// nothing stands behind (rule 3). A restore re-writes it through the same upsert.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/notes/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    let found = false
    await prisma.$transaction(async (tx) => {
      const result = await tx.note.updateMany({
        where: { id, orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (result.count === 0) return
      found = true
      await tx.activityEntry.deleteMany({ where: { orgId, sourceType: 'note', sourceId: id } })
    })
    if (!found) {
      return void res.status(404).json({ error: 'Note not found' })
    }

    logger.info({ orgId, userId, noteId: id }, 'trashed a note')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
