/**
 * Per-user, per-session undo-stack mirror (MAI-457).
 *
 * The browser owns the live undo stack. This route stores the small durable
 * mirror that lets the same browser session recover it after a reload.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

export const UNDO_ENTRY_STACK_LIMIT = 50

const sessionQuerySchema = z.object({
  sessionId: z.string({ error: 'sessionId is required.' }).trim().min(1, 'sessionId is required.'),
})

const createUndoEntrySchema = z.object({
  sessionId: z.string({ error: 'sessionId is required.' }).trim().min(1, 'sessionId is required.'),
  seq: z.number().int().nonnegative(),
  label: z.string({ error: 'label is required.' }).trim().min(1, 'label is required.'),
  inverseJson: z.array(z.unknown()),
  redoJson: z.array(z.unknown()),
})

function mapUndoEntry(entry: {
  id: string
  sessionId: string
  seq: number
  label: string
  inverseJson: Prisma.JsonValue
  redoJson: Prisma.JsonValue
  undone: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    seq: entry.seq,
    label: entry.label,
    inverseJson: entry.inverseJson,
    redoJson: entry.redoJson,
    undone: entry.undone,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

router.use(requireAuth)

// POST /api/orgs/:orgId/undo-entries — mirror one newly pushed browser entry.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/undo-entries', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = createUndoEntrySchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const undoEntry = await prisma.undoEntry.create({
      data: {
        orgId,
        userId: authReq.user!.id,
        sessionId: parsed.data.sessionId,
        seq: parsed.data.seq,
        label: parsed.data.label,
        inverseJson: parsed.data.inverseJson as Prisma.InputJsonValue,
        redoJson: parsed.data.redoJson as Prisma.InputJsonValue,
      },
    })

    // --- Return response ---
    return void res.status(201).json({ undoEntry: mapUndoEntry(undoEntry) })
  }),
)

// GET /api/orgs/:orgId/undo-entries?sessionId=... — recover the bounded stack.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/undo-entries', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = sessionQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Build filters ---
    const where = { orgId, userId: authReq.user!.id, sessionId: parsed.data.sessionId }

    // --- Execute query ---
    const undoEntries = await prisma.undoEntry.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: UNDO_ENTRY_STACK_LIMIT,
    })

    // --- Return response ---
    return void res.json({ undoEntries: undoEntries.map(mapUndoEntry) })
  }),
)

// DELETE /api/orgs/:orgId/undo-entries?sessionId=... — sign-out/session cleanup.
router.delete(
  '/',
  wrapRoute('DELETE /api/orgs/:orgId/undo-entries', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = sessionQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    await prisma.undoEntry.deleteMany({
      where: { orgId, userId: authReq.user!.id, sessionId: parsed.data.sessionId },
    })

    // --- Return response ---
    return void res.status(204).end()
  }),
)

export default router
