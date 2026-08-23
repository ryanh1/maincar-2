/**
 * Notification inbox routes (MAI-236).
 *
 * NotificationObjects are shared event facts; a Notification is one recipient's
 * private lifecycle row. This router only ever reads or writes the latter with
 * the authenticated recipient and path org in the same predicate.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25
export const LIST_MAX_LIMIT = 100
const MAX_BULK_ACTIONS = 100

const listQuerySchema = z.object({
  view: z.enum(['inbox', 'archived', 'snoozed']).default('inbox'),
  read: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  type: z.enum(['mentioned', 'assigned', 'commented', 'status_changed']).optional(),
  objectType: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
})

const actionSchema = z.enum(['read', 'unread', 'archive', 'unarchive', 'snooze', 'unsnooze'])
const actionBodySchema = z.object({
  action: actionSchema,
  snoozedUntil: z.coerce.date().optional(),
})
const bulkActionBodySchema = actionBodySchema.extend({
  notificationIds: z.array(z.string().trim().min(1)).min(1).max(MAX_BULK_ACTIONS),
})

class NotificationNotFound extends Error {
  status = 404

  constructor() {
    super('Notification not found')
  }
}

function snapshotFields(value: unknown): { title: string; preview: string | null } {
  const snapshot = value as { title?: unknown; preview?: unknown } | null
  return {
    // The event writer guarantees this shape. These guards keep a malformed
    // legacy row from ever echoing raw JSON through the inbox.
    title: typeof snapshot?.title === 'string' ? snapshot.title : 'Notification',
    preview: typeof snapshot?.preview === 'string' ? snapshot.preview : null,
  }
}

function actorFields(actor: { firstName: string | null; lastName: string | null; email: string; imageUrl: string | null } | null) {
  if (!actor) return null
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ') || actor.email
  return { name, imageUrl: actor.imageUrl }
}

function actionData(action: z.infer<typeof actionSchema>, snoozedUntil: Date | undefined): {
  readAt?: Date | null
  archivedAt?: Date | null
  snoozedUntil?: Date | null
} {
  const now = new Date()
  switch (action) {
    case 'read': return { readAt: now }
    case 'unread': return { readAt: null }
    case 'archive': return { archivedAt: now }
    case 'unarchive': return { archivedAt: null }
    case 'snooze':
      if (!snoozedUntil || snoozedUntil <= now) {
        throw Object.assign(new Error('snoozedUntil must be a future date.'), { status: 400 })
      }
      return { snoozedUntil }
    case 'unsnooze': return { snoozedUntil: null }
  }
}

async function applyAction(args: {
  orgId: string
  recipientUserId: string
  notificationIds: string[]
  action: z.infer<typeof actionSchema>
  snoozedUntil?: Date
}): Promise<number> {
  const notificationIds = [...new Set(args.notificationIds)]
  const data = actionData(args.action, args.snoozedUntil)

  return prisma.$transaction(async (tx) => {
    // Lock the exact private rows before deciding whether the batch is allowed.
    // If even one id belongs to another user or org, the whole transaction rolls
    // back and no partly-applied lifecycle transition can escape.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Notification"
      WHERE "id" IN (${Prisma.join(notificationIds)})
        AND "orgId" = ${args.orgId}
        AND "recipientUserId" = ${args.recipientUserId}
      FOR UPDATE
    `
    if (locked.length !== notificationIds.length) throw new NotificationNotFound()

    const updated = await tx.notification.updateMany({
      where: {
        id: { in: notificationIds },
        orgId: args.orgId,
        recipientUserId: args.recipientUserId,
      },
      data,
    })
    if (updated.count !== notificationIds.length) throw new NotificationNotFound()
    return updated.count
  })
}

router.use(requireAuth)

// GET /api/orgs/:orgId/notifications
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/notifications', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { view, read, type, objectType, page, limit } = parsed.data
    const now = new Date()

    // --- Build filters ---
    const where: Prisma.NotificationWhereInput = {
      orgId,
      recipientUserId: authReq.user!.id,
      ...(read === undefined ? {} : { readAt: read ? { not: null } : null }),
      ...(type || objectType
        ? { notificationObject: { ...(type ? { verb: type } : {}), ...(objectType ? { objectType } : {}) } }
        : {}),
      ...(view === 'archived'
        ? { archivedAt: { not: null } }
        : view === 'snoozed'
          ? { archivedAt: null, snoozedUntil: { gt: now } }
          : { archivedAt: null }),
    }

    // --- Execute query ---
    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          notificationObject: {
            include: { actor: { select: { firstName: true, lastName: true, email: true, imageUrl: true } } },
          },
        },
      }),
    ])
    const callIds = notifications
      .filter((notification) => notification.notificationObject.objectType === 'call')
      .map((notification) => notification.notificationObject.objectId)
    const accessibleCallIds = new Set(
      (await prisma.call.findMany({ where: { orgId, id: { in: callIds } }, select: { id: true } })).map((call) => call.id),
    )
    const noteIds = notifications
      .filter((notification) => notification.notificationObject.objectType === 'note')
      .map((notification) => notification.notificationObject.objectId)
    const noteTargetById = new Map(
      (await prisma.note.findMany({
        where: { orgId, deletedAt: null, id: { in: noteIds } },
        include: { links: { select: { toObject: true, toId: true } } },
      })).flatMap((note) => {
        const target = note.links[0]
        return target ? [[note.id, target] as const] : []
      }),
    )

    // --- Return response ---
    res.json({
      notifications: notifications.map((notification) => {
        const object = notification.notificationObject
        const snapshot = snapshotFields(object.sourceSnapshot)
        const noteTarget = noteTargetById.get(object.objectId)
        const available =
          (object.objectType === 'call' && accessibleCallIds.has(object.objectId)) ||
          (object.objectType === 'note' && !!noteTarget)
        const route =
          object.objectType === 'call'
            ? `/orgs/${orgId}/calls/${object.objectId}`
            : object.objectType === 'note' && noteTarget
              ? `/orgs/${orgId}/records/${encodeURIComponent(noteTarget.toObject)}?recordId=${encodeURIComponent(noteTarget.toId)}`
              : undefined
        return {
          id: notification.id,
          readAt: notification.readAt?.toISOString() ?? null,
          archivedAt: notification.archivedAt?.toISOString() ?? null,
          snoozedUntil: notification.snoozedUntil?.toISOString() ?? null,
          createdAt: notification.createdAt.toISOString(),
          actor: actorFields(object.actor),
          source: {
            status: available ? 'available' : 'unavailable',
            type: object.objectType,
            title: snapshot.title,
            preview: snapshot.preview,
            // A stored object ID is not a navigable target. Emit the route only
            // after the same existence check that marks the source available.
            ...(available && route ? { route } : {}),
          },
        }
      }),
      total,
      page,
      limit,
    })
  }),
)

// POST /api/orgs/:orgId/notifications/bulk
router.post(
  '/bulk',
  wrapRoute('POST /api/orgs/:orgId/notifications/bulk', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const parsed = bulkActionBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    const updated = await applyAction({ orgId, recipientUserId: authReq.user!.id, ...parsed.data })
    res.json({ updated })
  }),
)

// PATCH /api/orgs/:orgId/notifications/:id
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/notifications/:id', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const parsed = actionBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    const updated = await applyAction({
      orgId,
      recipientUserId: authReq.user!.id,
      notificationIds: [String(req.params.id)],
      ...parsed.data,
    })
    res.json({ updated })
  }),
)

export default router
