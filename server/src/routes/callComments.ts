/**
 * Timed call-comment routes (MAI-244).
 *
 * Mounted below one verified call, each comment remains in the call's org even
 * when a transcript is regenerated. The root's atMs is the durable media anchor;
 * optional selection fields merely help the client re-highlight nearby text.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { flattenTipTapText } from '../crm/taskNote.js'
import { resolveTeammateMentions } from '../crm/mentions.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const bodyJsonSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'bodyJson must be a TipTap document object.' },
)

const optionalText = z.string().trim().min(1).max(20_000).optional()

const createRootSchema = z
  .object({
    bodyJson: bodyJsonSchema,
    // Zero is a real playhead location. Do not use a truthiness check here.
    atMs: z.number().int().min(0, 'atMs must be zero or greater.'),
    anchorEndMs: z.number().int().min(0).optional(),
    anchorQuote: optionalText,
    selectionStartChar: z.number().int().min(0).optional(),
    selectionEndChar: z.number().int().min(0).optional(),
    transcriptId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.anchorEndMs !== undefined && value.anchorEndMs < value.atMs) {
      ctx.addIssue({ code: 'custom', message: 'anchorEndMs cannot be before atMs.', path: ['anchorEndMs'] })
    }
    if (
      value.selectionStartChar !== undefined &&
      value.selectionEndChar !== undefined &&
      value.selectionEndChar < value.selectionStartChar
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'selectionEndChar cannot be before selectionStartChar.',
        path: ['selectionEndChar'],
      })
    }
  })

const replySchema = z.object({ bodyJson: bodyJsonSchema })
const updateSchema = z.object({ bodyJson: bodyJsonSchema })
const emojiSchema = z.string().trim().min(1).max(32)
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const commentInclude = {
  author: { select: { id: true, firstName: true, lastName: true, imageUrl: true } },
  reactions: { select: { userId: true, emoji: true } },
} satisfies Prisma.CallCommentInclude

type CallCommentRecord = Prisma.CallCommentGetPayload<{ include: typeof commentInclude }>
type CallCommentThreadRecord = CallCommentRecord & { replies: CallCommentRecord[] }

const threadInclude = {
  ...commentInclude,
  replies: { orderBy: { createdAt: 'asc' }, include: commentInclude },
} satisfies Prisma.CallCommentInclude

function mapAuthor(author: CallCommentRecord['author']) {
  if (!author) return null
  const name = [author.firstName, author.lastName].filter(Boolean).join(' ').trim()
  return { id: author.id, name: name || 'Unknown', imageUrl: author.imageUrl }
}

function mapCallComment(comment: CallCommentRecord) {
  const isDeleted = comment.deletedAt !== null
  return {
    id: comment.id,
    parentId: comment.parentId,
    atMs: comment.atMs,
    anchorEndMs: comment.anchorEndMs,
    anchorQuote: comment.anchorQuote,
    selectionStartChar: comment.selectionStartChar,
    selectionEndChar: comment.selectionEndChar,
    transcriptId: comment.transcriptId,
    // A root tombstone remains in a thread but must not expose its old content.
    bodyJson: isDeleted ? null : comment.bodyJson,
    bodyText: isDeleted ? null : comment.bodyText,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: mapAuthor(comment.author),
    reactions: comment.reactions.map((reaction) => ({ userId: reaction.userId, emoji: reaction.emoji })),
  }
}

async function requireCall(orgId: string, callId: string): Promise<boolean> {
  const call = await prisma.call.findFirst({ where: { id: callId, orgId }, select: { id: true } })
  return Boolean(call)
}

async function requireLiveComment(args: { orgId: string; callId: string; commentId: string }) {
  return prisma.callComment.findFirst({
    where: { id: args.commentId, orgId: args.orgId, callId: args.callId },
  })
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/calls/:callId/comments — paged root threads
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/calls/:callId/comments', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await requireCall(orgId, callId))) return void res.status(404).json({ error: 'Call not found' })

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const { page, limit } = parsed.data
    const where = { orgId, callId, parentId: null }

    // --- Execute query ---
    const [total, comments] = await Promise.all([
      prisma.callComment.count({ where }),
      prisma.callComment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: threadInclude,
      }),
    ])

    // --- Return response ---
    res.json({
      comments: (comments as CallCommentThreadRecord[]).map((comment) => ({
        ...mapCallComment(comment),
        replies: comment.replies.map(mapCallComment),
      })),
      total,
      page,
      limit,
    })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/calls/:callId/comments — add a timed root comment
// ============================================================
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/calls/:callId/comments', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await requireCall(orgId, callId))) return void res.status(404).json({ error: 'Call not found' })

    // --- Parse & validate params ---
    const parsed = createRootSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const input = parsed.data

    // A transcript id is selection context, not a foreign-tenant pointer.
    if (input.transcriptId) {
      const transcript = await prisma.transcript.findFirst({
        where: { id: input.transcriptId, orgId, callId },
        select: { id: true },
      })
      if (!transcript) return void res.status(422).json({ error: 'Transcript selection does not belong to this call.' })
    }

    const mentions = await resolveTeammateMentions(prisma, { orgId, content: input.bodyJson })
    if (mentions.rejectedUserIds.length > 0) {
      return void res.status(422).json({ error: 'A mentioned teammate is inactive or outside this organization.' })
    }

    // --- Execute query ---
    const comment = await prisma.callComment.create({
      data: {
        orgId,
        callId,
        authorUserId: userId,
        bodyJson: input.bodyJson as Prisma.InputJsonValue,
        bodyText: flattenTipTapText(input.bodyJson),
        atMs: input.atMs,
        anchorEndMs: input.anchorEndMs,
        anchorQuote: input.anchorQuote,
        selectionStartChar: input.selectionStartChar,
        selectionEndChar: input.selectionEndChar,
        transcriptId: input.transcriptId,
      },
      include: commentInclude,
    })

    logger.info({ orgId, callId, userId, commentId: comment.id }, 'created a timed call comment')

    // --- Return response ---
    res.status(201).json({ comment: mapCallComment(comment) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/calls/:callId/comments/:commentId/replies
// ============================================================
router.post(
  '/:commentId/replies',
  wrapRoute('POST /api/orgs/:orgId/calls/:callId/comments/:commentId/replies', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)
    const commentId = String(req.params.commentId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await requireCall(orgId, callId))) return void res.status(404).json({ error: 'Call not found' })

    // --- Parse & validate params ---
    const parsed = replySchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const mentions = await resolveTeammateMentions(prisma, { orgId, content: parsed.data.bodyJson })
    if (mentions.rejectedUserIds.length > 0) {
      return void res.status(422).json({ error: 'A mentioned teammate is inactive or outside this organization.' })
    }

    // --- Execute query ---
    // This parent lock shares the deletion transaction's lock. A root either
    // receives the reply before deletion can decide it is a leaf, or is already
    // tombstoned before this request examines it — never an FK-race 500.
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CallComment"
        WHERE "id" = ${commentId} AND "orgId" = ${orgId} AND "callId" = ${callId}
        FOR UPDATE
      `
      if (locked.length === 0) return { kind: 'not-found' as const }

      const parent = await tx.callComment.findFirst({ where: { id: commentId, orgId, callId } })
      if (!parent) return { kind: 'not-found' as const }
      if (parent.deletedAt) return { kind: 'deleted' as const }
      if (parent.parentId) return { kind: 'too-deep' as const }

      const comment = await tx.callComment.create({
        data: {
          orgId,
          callId,
          parentId: parent.id,
          authorUserId: userId,
          bodyJson: parsed.data.bodyJson as Prisma.InputJsonValue,
          bodyText: flattenTipTapText(parsed.data.bodyJson),
          // Replies deliberately have no local anchor: their root is their moment.
          atMs: undefined,
        },
        include: commentInclude,
      })
      return { kind: 'created' as const, comment, parentId: parent.id }
    })

    if (outcome.kind === 'not-found') return void res.status(404).json({ error: 'Call comment not found' })
    if (outcome.kind === 'deleted') return void res.status(400).json({ error: 'Cannot reply to a deleted call comment.' })
    if (outcome.kind === 'too-deep') return void res.status(400).json({ error: 'Call comments support one reply level.' })

    logger.info({ orgId, callId, userId, commentId: outcome.comment.id, parentId: outcome.parentId }, 'replied to a timed call comment')

    // --- Return response ---
    res.status(201).json({ comment: mapCallComment(outcome.comment) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/calls/:callId/comments/:commentId
// ============================================================
router.patch(
  '/:commentId',
  wrapRoute('PATCH /api/orgs/:orgId/calls/:callId/comments/:commentId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)
    const commentId = String(req.params.commentId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await requireCall(orgId, callId))) return void res.status(404).json({ error: 'Call not found' })
    const existing = await requireLiveComment({ orgId, callId, commentId })
    if (!existing) return void res.status(404).json({ error: 'Call comment not found' })
    if (existing.deletedAt) return void res.status(400).json({ error: 'Call comment has been deleted.' })
    if (existing.authorUserId !== userId) return void res.status(403).json({ error: 'Only the author can edit this call comment.' })

    // --- Parse & validate params ---
    const parsed = updateSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const mentions = await resolveTeammateMentions(prisma, { orgId, content: parsed.data.bodyJson })
    if (mentions.rejectedUserIds.length > 0) {
      return void res.status(422).json({ error: 'A mentioned teammate is inactive or outside this organization.' })
    }

    // --- Execute query ---
    const result = await prisma.callComment.updateMany({
      where: { id: commentId, orgId, callId, authorUserId: userId, deletedAt: null },
      data: {
        bodyJson: parsed.data.bodyJson as Prisma.InputJsonValue,
        bodyText: flattenTipTapText(parsed.data.bodyJson),
      },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Call comment not found' })
    const updated = await prisma.callComment.findFirst({
      where: { id: commentId, orgId, callId, deletedAt: null },
      include: commentInclude,
    })
    if (!updated) return void res.status(404).json({ error: 'Call comment not found' })

    logger.info({ orgId, callId, userId, commentId }, 'updated a timed call comment')

    // --- Return response ---
    res.json({ comment: mapCallComment(updated) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId
// ============================================================
router.delete(
  '/:commentId',
  wrapRoute('DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)
    const commentId = String(req.params.commentId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    if (!(await requireCall(orgId, callId))) return void res.status(404).json({ error: 'Call not found' })
    // --- Execute query ---
    // A new reply arriving between a read and a hard delete would be silently
    // cascaded. Lock the root row, inspect its children, then choose tombstone or
    // leaf deletion while that decision remains true.
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CallComment"
        WHERE "id" = ${commentId} AND "orgId" = ${orgId} AND "callId" = ${callId}
        FOR UPDATE
      `
      if (locked.length === 0) return 'not-found' as const

      const existing = await tx.callComment.findFirst({
        where: { id: commentId, orgId, callId },
        include: { replies: { select: { id: true }, take: 1 } },
      })
      if (!existing || existing.deletedAt) return 'not-found' as const
      if (existing.authorUserId !== userId) return 'forbidden' as const

      const where = { id: commentId, orgId, callId, authorUserId: userId, deletedAt: null }
      const result =
        existing.replies.length > 0
          ? await tx.callComment.updateMany({ where, data: { deletedAt: new Date() } })
          : await tx.callComment.deleteMany({ where })
      return result.count === 0 ? ('not-found' as const) : ('deleted' as const)
    })
    if (outcome === 'not-found') return void res.status(404).json({ error: 'Call comment not found' })
    if (outcome === 'forbidden') {
      return void res.status(403).json({ error: 'Only the author can delete this call comment.' })
    }

    logger.info({ orgId, callId, userId, commentId }, 'deleted a timed call comment')

    // --- Return response ---
    res.status(204).end()
  }),
)

// ============================================================
// PUT/DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId/reactions/:emoji
// ============================================================
async function requireReactionContext(
  req: AuthenticatedRequest,
  res: import('express').Response,
): Promise<{ orgId: string; callId: string; commentId: string; userId: string } | null> {
  const orgId = String(req.params.orgId)
  const callId = String(req.params.callId)
  const commentId = String(req.params.commentId)
  const membership = await requireMembership(req, res, orgId)
  if (!membership) return null
  if (!(await requireCall(orgId, callId))) {
    res.status(404).json({ error: 'Call not found' })
    return null
  }
  return { orgId, callId, commentId, userId: req.user!.id }
}

async function withLockedReactionComment<T>(
  context: { orgId: string; callId: string; commentId: string },
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CallComment"
      WHERE "id" = ${context.commentId} AND "orgId" = ${context.orgId} AND "callId" = ${context.callId}
      FOR UPDATE
    `
    if (locked.length === 0) return null
    const comment = await tx.callComment.findFirst({
      where: { id: context.commentId, orgId: context.orgId, callId: context.callId, deletedAt: null },
      select: { id: true },
    })
    if (!comment) return null
    return mutate(tx)
  })
}

router.put(
  '/:commentId/reactions/:emoji',
  wrapRoute('PUT /api/orgs/:orgId/calls/:callId/comments/:commentId/reactions/:emoji', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const context = await requireReactionContext(authReq, res)
    if (!context) return
    const parsed = emojiSchema.safeParse(req.params.emoji)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // The unique key (commentId, userId, emoji) makes this an idempotent PUT.
    const written = await withLockedReactionComment(context, (tx) =>
      tx.callCommentReaction.createMany({
        data: { orgId: context.orgId, commentId: context.commentId, userId: context.userId, emoji: parsed.data },
        skipDuplicates: true,
      }),
    )
    if (!written) return void res.status(404).json({ error: 'Call comment not found' })
    res.status(204).end()
  }),
)

router.delete(
  '/:commentId/reactions/:emoji',
  wrapRoute('DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId/reactions/:emoji', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const context = await requireReactionContext(authReq, res)
    if (!context) return
    const parsed = emojiSchema.safeParse(req.params.emoji)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // Delete-by-key is also idempotent: an absent personal reaction is already
    // the requested state, but an absent comment is handled above as a 404.
    const deleted = await withLockedReactionComment(context, (tx) =>
      tx.callCommentReaction.deleteMany({
        where: { orgId: context.orgId, commentId: context.commentId, userId: context.userId, emoji: parsed.data },
      }),
    )
    if (!deleted) return void res.status(404).json({ error: 'Call comment not found' })
    res.status(204).end()
  }),
)

export default router
