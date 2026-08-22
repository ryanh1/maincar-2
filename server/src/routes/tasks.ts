/**
 * Task routes — the org's open work (MAI-141 T13; spec §6, plan T13).
 *
 * Mounted at /api/orgs/:orgId/tasks. The org lives in the path, never the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches. Every route requires auth and an active membership in the org
 * named by the path, and every read AND write carries the orgId filter —
 * `findFirst`/`updateMany` with orgId, never by id alone
 * (.claude/rules/database-and-prisma.md).
 *
 * FULL CRUD, unlike the read-only activity routes next door, and the difference is
 * not an inconsistency: emails, texts, and meetings are records of things that
 * already happened somewhere else, so writing one here would be inventing history.
 * A task is a thing a rep creates, so this IS where it comes from.
 *
 * THREE RULES THIS FILE HOLDS TO:
 *
 *   1. ATTACHMENTS GO THROUGH `RecordLink`. A task attaches to a person, a
 *      company, a deal, or a custom record through server/src/crm/workLinks.ts —
 *      the seam T7 put there — and never through columns on Task. There is no
 *      parallel link table.
 *   2. `origin` IS SET AT CREATE AND NEVER PATCHED. It says whether a calendar
 *      sync owns this row or a person does, and a sync that could flip a
 *      hand-made task to `calendar` would be a sync that can delete work somebody
 *      committed to by hand (spec §6, impacts 7b.13).
 *   3. `isDone` AND `doneAt` MOVE TOGETHER, here, in the one place that writes
 *      them. A list filters on the flag and a "completed this week" view reads the
 *      timestamp; a row where they disagree is a row that appears in one and not
 *      the other.
 *
 * ONE FEED ROW. A task's create, complete, and reopen transitions refresh the
 * same idempotent `ActivityEntry`; due-date edits remain scheduling changes, not
 * account-history events.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  TASK_COMMITMENTS,
  TASK_ORIGINS,
  TASK_PRIORITIES,
  TASK_TYPES,
  mapLinksToApi,
  mapTaskToApi,
  rollUpSpineLinks,
} from '../crm/taskNote.js'
import { activityFromTask, recordActivityInTx } from '../crm/activityFeed.js'
import {
  MAX_LINKS_PER_WORK_ITEM,
  dedupeLinkTargets,
  idsLinkedToRecord,
  loadWorkLinks,
  syncWorkLinks,
  verifyLinkTargets,
} from '../crm/workLinks.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25

// 100, the same ceiling the call history, the email list, the message list, and
// the meeting list use: a list is read a page at a time.
export const LIST_MAX_LIMIT = 100

// Each token IS the Prisma field name it orders by, so the orderBy is built
// straight from the parsed value with no second mapping to drift — and the enum
// is the allowlist that stops an arbitrary column name reaching the query.
const SORT_FIELDS = ['dueAt', 'createdAt', 'updatedAt', 'title', 'priority'] as const

/** An untouched optional query param arrives as `""`, which means "no filter". */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

// "true"/"false" only: an unparseable value is a 400 rather than a silent `false`,
// which would quietly answer a different question than the one asked.
const optionalBool = z.preprocess(
  blankToUndefined,
  z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
)

const linkTargetSchema = z.object({
  // The object SLUG the link points at — person | company | deal | <custom>. The
  // same vocabulary RecordLink.toObject already speaks.
  object: z.string().trim().min(1).max(60),
  id: z.string().trim().min(1),
})

const linksSchema = z
  .array(linkTargetSchema)
  .max(MAX_LINKS_PER_WORK_ITEM, `A task can be attached to at most ${MAX_LINKS_PER_WORK_ITEM} records.`)

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
    .default('dueAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('asc'),

  assigneeUserId: optionalId,
  isDone: optionalBool,
  type: z.enum(TASK_TYPES, { error: `type is one of: ${TASK_TYPES.join(', ')}.` }).optional(),
  priority: z
    .enum(TASK_PRIORITIES, { error: `priority is one of: ${TASK_PRIORITIES.join(', ')}.` })
    .optional(),
  commitment: z
    .enum(TASK_COMMITMENTS, { error: `commitment is one of: ${TASK_COMMITMENTS.join(', ')}.` })
    .optional(),

  // The acceptance criterion, as a filter: "show me only what the calendar made"
  // and "show me only what people typed" are two different lists, and this is what
  // makes them two different lists.
  origin: z
    .enum(TASK_ORIGINS, { error: `origin is one of: ${TASK_ORIGINS.join(', ')}.` })
    .optional(),
  eventId: optionalId,

  // Half-open window [dueFrom, dueTo): a week view asks Monday-to-Monday and must
  // not double-count a task due exactly on the boundary.
  dueFrom: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  dueTo: z.preprocess(blankToUndefined, z.coerce.date().optional()),

  // "The tasks attached to this record" — both halves required together, because
  // an object with no id is not a filter and an id with no object is ambiguous.
  linkObject: z.preprocess(blankToUndefined, z.string().trim().min(1).max(60).optional()),
  linkId: optionalId,

  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

const createBodySchema = z.object({
  title: z.string().trim().min(1, 'A task needs a title.').max(500, 'That title is too long.'),
  body: z.string().max(10_000, 'That body is too long.').nullish(),
  type: z.enum(TASK_TYPES, { error: `type is one of: ${TASK_TYPES.join(', ')}.` }).default('todo'),
  priority: z
    .enum(TASK_PRIORITIES, { error: `priority is one of: ${TASK_PRIORITIES.join(', ')}.` })
    .default('med'),
  commitment: z
    .enum(TASK_COMMITMENTS, { error: `commitment is one of: ${TASK_COMMITMENTS.join(', ')}.` })
    .default('soft'),
  assigneeUserId: z.string().trim().min(1).nullish(),
  dueAt: z.coerce.date().nullish(),
  remindAt: z.coerce.date().nullish(),
  eventId: z.string().trim().min(1).nullish(),
  origin: z
    .enum(TASK_ORIGINS, { error: `origin is one of: ${TASK_ORIGINS.join(', ')}.` })
    .default('manual'),
  links: linksSchema.optional(),
})

// `origin` is absent on purpose — see rule 2 in the module header. Everything else
// is optional, and a key that is present-but-null CLEARS the field, which is a
// different instruction from a key that is absent (leave it alone).
const updateBodySchema = z.object({
  title: z.string().trim().min(1, 'A task needs a title.').max(500, 'That title is too long.').optional(),
  body: z.string().max(10_000, 'That body is too long.').nullish(),
  type: z.enum(TASK_TYPES, { error: `type is one of: ${TASK_TYPES.join(', ')}.` }).optional(),
  priority: z
    .enum(TASK_PRIORITIES, { error: `priority is one of: ${TASK_PRIORITIES.join(', ')}.` })
    .optional(),
  commitment: z
    .enum(TASK_COMMITMENTS, { error: `commitment is one of: ${TASK_COMMITMENTS.join(', ')}.` })
    .optional(),
  assigneeUserId: z.string().trim().min(1).nullish(),
  dueAt: z.coerce.date().nullish(),
  remindAt: z.coerce.date().nullish(),
  eventId: z.string().trim().min(1).nullish(),
  isDone: z.boolean().optional(),
  links: linksSchema.optional(),
})

/**
 * Is this user someone this org may assign work to?
 *
 * An ACTIVE membership, checked server-side, because an assignee id arrives in the
 * body and a body is not evidence. Assigning a task to somebody in another org
 * would put this org's work on a screen it must never reach.
 */
async function assigneeIsMember(orgId: string, userId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { orgId, userId, isActive: true },
    select: { id: true },
  })
  return membership !== null
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/tasks — the org's task list
// ============================================================
// Paginated, sortable, and filterable by assignee, done-ness, type, priority,
// commitment, ORIGIN, event, attached record, due window, and free text. Trashed
// rows are excluded. The count and the page are read against the SAME where
// clause, so `total` and the rows can never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/tasks', async (req, res) => {
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
    const {
      page, limit, sort, dir, assigneeUserId, isDone, type, priority, commitment,
      origin, eventId, dueFrom, dueTo, linkObject, linkId, q,
    } = parsed.data

    if (dueFrom && dueTo && dueTo < dueFrom) {
      return void res.status(400).json({ error: 'dueTo must not be before dueFrom.' })
    }
    if ((linkObject === undefined) !== (linkId === undefined)) {
      return void res
        .status(400)
        .json({ error: 'Filtering by attachment needs both linkObject and linkId.' })
    }

    // --- Build filters ---
    // "Attached to this record" resolves through RecordLink first, then narrows the
    // page to those ids. An empty result stays an EMPTY page — never an unfiltered
    // one, which is what an `in: []` guarantees and a dropped clause would not.
    let linkedIds: string[] | null = null
    if (linkObject && linkId) {
      linkedIds = await idsLinkedToRecord(prisma, {
        orgId,
        source: 'task',
        target: { object: linkObject, id: linkId },
      })
    }

    const dueRange =
      dueFrom || dueTo
        ? { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lt: dueTo } : {}) }
        : undefined

    const where: Prisma.TaskWhereInput = {
      orgId,
      deletedAt: null,
      ...(linkedIds ? { id: { in: linkedIds } } : {}),
      ...(assigneeUserId ? { assigneeUserId } : {}),
      ...(isDone === undefined ? {} : { isDone }),
      ...(type ? { type } : {}),
      ...(priority ? { priority } : {}),
      ...(commitment ? { commitment } : {}),
      ...(origin ? { origin } : {}),
      ...(eventId ? { eventId } : {}),
      ...(dueRange ? { dueAt: dueRange } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { body: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    // `dueAt` is nullable, so a plain sort would let Postgres decide where the
    // undated tasks land. They go LAST either way: a task with no due date is not
    // the most urgent thing on the list, and it is not the least recent either —
    // it simply is not on the calendar, so it sits below the ones that are.
    // createdAt is the stable tie-break, so rows sharing a due date keep a
    // deterministic order across pages.
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      sort === 'dueAt'
        ? [{ dueAt: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' as const }]
        : sort === 'createdAt'
          ? [{ createdAt: dir }]
          : [{ [sort]: dir }, { createdAt: 'desc' as const }]

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        // The attachments ride along: a task card renders the record it is about,
        // and fetching that per row is the N+1 this avoids. They are few by
        // construction (MAX_LINKS_PER_WORK_ITEM).
        include: { links: { select: { toObject: true, toId: true } } },
      }),
    ])

    // --- Return response ---
    res.json({ tasks: tasks.map((task) => mapTaskToApi(task)), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/tasks/:id — one task, with its attachments
// ============================================================
// A task in another org, one that does not exist, and one in the trash are all
// answered 404 the same way, so this route never confirms the existence of a row
// it must not reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/tasks/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // id AND orgId together, never id alone: the tenant key is half the lookup.
    const task = await prisma.task.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!task) {
      return void res.status(404).json({ error: 'Task not found' })
    }
    const links = await loadWorkLinks(prisma, { orgId, source: 'task', sourceId: id })

    // --- Return response ---
    res.json({ task: { ...mapTaskToApi(task), links: mapLinksToApi(links) } })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/tasks — create a task and attach it to records
// ============================================================
// The T13 acceptance criterion lives here: `links` attaches the task to a person,
// a company, or a deal through RecordLink, and `origin` records whether a calendar
// sync or a person made it.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/tasks', async (req, res) => {
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
    const body = parsed.data
    const targets = dedupeLinkTargets(body.links ?? [])

    // --- Verify the assignee is in this org ---
    if (body.assigneeUserId && !(await assigneeIsMember(orgId, body.assigneeUserId))) {
      return void res.status(422).json({ error: 'That assignee is not a member of this org.' })
    }

    // --- Verify every attachment target exists in this org ---
    const badTarget = await verifyLinkTargets(prisma, orgId, targets)
    if (badTarget) {
      return void res.status(422).json({ error: badTarget })
    }

    // --- Execute the write atomically ---
    // The task and its attachments commit together: a task that saved without the
    // record it is about is a task nobody will find on the page they expected.
    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          // orgId from the PATH, never the body.
          orgId,
          title: body.title,
          body: body.body ?? null,
          type: body.type,
          priority: body.priority,
          commitment: body.commitment,
          assigneeUserId: body.assigneeUserId ?? null,
          dueAt: body.dueAt ?? null,
          remindAt: body.remindAt ?? null,
          eventId: body.eventId ?? null,
          origin: body.origin,
        },
      })
      await syncWorkLinks(tx, { orgId, source: 'task', sourceId: task.id, targets })
      await recordActivityInTx(tx, activityFromTask(task, 'created', rollUpSpineLinks(targets), userId))
      return task
    })

    logger.info(
      { orgId, userId, taskId: created.id, origin: created.origin, links: targets.length },
      'created a task',
    )

    // --- Return response ---
    res.status(201).json({ task: { ...mapTaskToApi(created), links: targets } })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/tasks/:id — edit, reassign, complete, re-attach
// ============================================================
// `origin` is not editable (rule 2). `isDone` and `doneAt` move together (rule 3).
// `links`, when present, REPLACES the whole attachment set — a PATCH that omits it
// leaves the attachments alone.
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/tasks/:id', async (req, res) => {
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
    const existing = await prisma.task.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) {
      return void res.status(404).json({ error: 'Task not found' })
    }

    if (body.assigneeUserId && !(await assigneeIsMember(orgId, body.assigneeUserId))) {
      return void res.status(422).json({ error: 'That assignee is not a member of this org.' })
    }

    const targets = body.links === undefined ? null : dedupeLinkTargets(body.links)
    if (targets) {
      const badTarget = await verifyLinkTargets(prisma, orgId, targets)
      if (badTarget) {
        return void res.status(422).json({ error: badTarget })
      }
    }

    // --- Build the update ---
    // `undefined` means "not mentioned"; `null` on a nullish field means "clear it".
    //
    // The `Unchecked` variant, because `assigneeUserId` is a relation's foreign key
    // and the checked input hides it behind a nested `assignee: { connect }`. Setting
    // the scalar directly is what lets "assign to nobody" be `null` rather than a
    // second code path — and the id it sets was already proven to belong to an active
    // member of THIS org above.
    const data: Prisma.TaskUncheckedUpdateManyInput = {}
    if (body.title !== undefined) data.title = body.title
    if (body.body !== undefined) data.body = body.body ?? null
    if (body.type !== undefined) data.type = body.type
    if (body.priority !== undefined) data.priority = body.priority
    if (body.commitment !== undefined) data.commitment = body.commitment
    if (body.assigneeUserId !== undefined) data.assigneeUserId = body.assigneeUserId ?? null
    if (body.dueAt !== undefined) data.dueAt = body.dueAt ?? null
    if (body.remindAt !== undefined) data.remindAt = body.remindAt ?? null
    if (body.eventId !== undefined) data.eventId = body.eventId ?? null

    // The flag and its timestamp, written as a pair (rule 3). Re-completing an
    // already-done task keeps the ORIGINAL doneAt: "when was this finished" must
    // not move because somebody re-ticked a box.
    const transitionAt = new Date()
    const transition = body.isDone === undefined || body.isDone === existing.isDone
      ? null
      : body.isDone ? 'completed' as const : 'reopened' as const
    if (transition) {
      data.isDone = body.isDone
      data.doneAt = body.isDone ? transitionAt : null
    }

    // --- Execute the write atomically ---
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        // updateMany with orgId in the where, never update by id: the tenant
        // boundary lives in the where clause.
        const result = await tx.task.updateMany({ where: { id, orgId, deletedAt: null }, data })
        if (result.count === 0) throw new Error('task vanished mid-update')
      }
      if (targets) {
        await syncWorkLinks(tx, { orgId, source: 'task', sourceId: id, targets })
      }
      if (transition) {
        const finalLinks = targets ?? mapLinksToApi(await loadWorkLinks(tx, { orgId, source: 'task', sourceId: id }))
        await recordActivityInTx(
          tx,
          activityFromTask(
            { ...existing, doneAt: data.doneAt as Date | null, updatedAt: transitionAt },
            transition,
            rollUpSpineLinks(finalLinks),
            userId,
          ),
        )
      }
    })

    logger.info({ orgId, userId, taskId: id }, 'updated a task')

    // --- Return response ---
    const updated = await prisma.task.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!updated) {
      return void res.status(404).json({ error: 'Task not found' })
    }
    const links = await loadWorkLinks(prisma, { orgId, source: 'task', sourceId: id })
    res.json({ task: { ...mapTaskToApi(updated), links: mapLinksToApi(links) } })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/tasks/:id — soft-delete into the 30-day trash
// ============================================================
// The row stays, with `deletedAt` and `deletedById` set (spec §5.13). The links
// stay too: restoring a task must restore what it was about, and a cascade here
// would make the restore a lie.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/tasks/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.task.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Task not found' })
    }

    logger.info({ orgId, userId, taskId: id }, 'trashed a task')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router
