/**
 * Field-history reader (MAI-330).
 *
 * History is append-only evidence, not the source of a record's current value.
 * This route gives the field-history popover a bounded, newest-first read for one
 * record attribute without exposing another organization's audit trail.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

export const FIELD_HISTORY_PAGE_SIZE = 50

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const fieldHistoryQuerySchema = z.object({
  recordId: z.string({ error: 'recordId is required.' }).trim().min(1, 'recordId is required.'),
  attribute: z.string({ error: 'attribute is required.' }).trim().min(1, 'attribute is required.'),
  cursor: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
})

interface FieldHistoryCursor {
  changedAt: Date
  id: string
}

function encodeCursor(cursor: FieldHistoryCursor): string {
  return Buffer.from(JSON.stringify({ changedAt: cursor.changedAt.toISOString(), id: cursor.id })).toString('base64url')
}

function decodeCursor(value: string): FieldHistoryCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { changedAt, id } = parsed as Record<string, unknown>
    if (typeof changedAt !== 'string' || typeof id !== 'string' || id.trim() === '') return null
    const date = new Date(changedAt)
    return Number.isNaN(date.getTime()) ? null : { changedAt: date, id }
  } catch {
    return null
  }
}

function mapHistoryToApi(row: {
  id: string
  recordId: string
  attribute: string
  oldJson: Prisma.JsonValue | null
  newJson: Prisma.JsonValue | null
  changedByUserId: string | null
  changeSource: string
  reason: string | null
  changedAt: Date
}) {
  return {
    id: row.id,
    recordId: row.recordId,
    attribute: row.attribute,
    oldValue: row.oldJson,
    newValue: row.newJson,
    changedByUserId: row.changedByUserId,
    changeSource: row.changeSource,
    reason: row.reason,
    changedAt: row.changedAt.toISOString(),
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/field-history — one record attribute's audit trail
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/field-history', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = fieldHistoryQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { recordId, attribute, cursor } = parsed.data
    const decodedCursor = cursor ? decodeCursor(cursor) : null
    if (cursor && !decodedCursor) return void res.status(400).json({ error: 'cursor is invalid.' })

    // --- Build filters ---
    // The id resolves only within the path organization. The paired id makes this
    // audit read precise even if an attribute slug recurs on other records.
    const where: Prisma.FieldHistoryWhereInput = {
      orgId,
      recordId,
      attribute,
      ...(decodedCursor
        ? {
            AND: [
              {
                OR: [
                  { changedAt: { lt: decodedCursor.changedAt } },
                  { changedAt: decodedCursor.changedAt, id: { lt: decodedCursor.id } },
                ],
              },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    // `id` breaks timestamp ties, so the page boundary can never repeat or omit
    // entries that were written in the same clock tick.
    const rows = await prisma.fieldHistory.findMany({
      where,
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: FIELD_HISTORY_PAGE_SIZE + 1,
    })
    const hasMore = rows.length > FIELD_HISTORY_PAGE_SIZE
    const pageRows = hasMore ? rows.slice(0, FIELD_HISTORY_PAGE_SIZE) : rows

    // --- Return response ---
    res.json({
      history: pageRows.map(mapHistoryToApi),
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
    })
  }),
)

export default router
