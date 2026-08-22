/**
 * Account-timeline reader (MAI-274).
 *
 * This is deliberately separate from the compact /activity feed: a timeline has
 * a Company or Deal root, a bounded time frame, and its own projection fields.
 * Its page read still comes from ActivityEntry alone, with no source joins.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { ACTIVITY_DIRECTIONS, ACTIVITY_SOURCE_TYPES } from '../crm/activityFeed.js'
import {
  DENSE_TIMELINE_EVENT_COUNT,
  resolveSmartTimelineRange,
} from '../crm/accountTimeline.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

export const ACCOUNT_TIMELINE_DEFAULT_LIMIT = 50
export const ACCOUNT_TIMELINE_MAX_LIMIT = 100

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const accountTimelineQuerySchema = z.object({
  rootType: z.enum(['company', 'deal'], { error: 'rootType is company or deal.' }),
  rootId: z.string({ error: 'rootId is required.' }).trim().min(1, 'rootId is required.'),
  occurredFrom: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  occurredTo: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one event.')
    .max(ACCOUNT_TIMELINE_MAX_LIMIT, `Ask for at most ${ACCOUNT_TIMELINE_MAX_LIMIT} events at a time.`)
    .default(ACCOUNT_TIMELINE_DEFAULT_LIMIT),
  sourceType: z.preprocess(
    blankToUndefined,
    z.enum(ACTIVITY_SOURCE_TYPES, { error: `sourceType is one of: ${ACTIVITY_SOURCE_TYPES.join(', ')}.` }).optional(),
  ),
  direction: z.preprocess(
    blankToUndefined,
    z.enum(ACTIVITY_DIRECTIONS, { error: `direction is one of: ${ACTIVITY_DIRECTIONS.join(', ')}.` }).optional(),
  ),
  personId: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  dealId: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  cursor: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
})

interface TimelineCursor {
  occurredAt: Date
  id: string
}

function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify({ occurredAt: cursor.occurredAt.toISOString(), id: cursor.id })).toString('base64url')
}

function decodeTimelineCursor(value: string): TimelineCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { occurredAt, id } = parsed as Record<string, unknown>
    if (typeof occurredAt !== 'string' || typeof id !== 'string' || id.trim() === '') return null
    const date = new Date(occurredAt)
    return Number.isNaN(date.getTime()) ? null : { occurredAt: date, id }
  } catch {
    return null
  }
}

function mapTimelineEventToApi(entry: {
  id: string
  sourceType: string
  sourceId: string
  timelineTitle: string
  preview: string | null
  timelineSubtype: string | null
  timelineIntensity: number
  timelineDisplay: Prisma.JsonValue | null
  timelineMarker: Prisma.JsonValue | null
  direction: string | null
  occurredAt: Date
  companyId: string | null
  personId: string | null
  dealId: string | null
}) {
  return {
    id: entry.id,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    title: entry.timelineTitle,
    preview: entry.preview,
    subtype: entry.timelineSubtype,
    intensity: entry.timelineIntensity,
    // The v1 migration made this nullable for existing feed rows. A reader must
    // still give clients a snapshot-shaped value while those legacy rows remain.
    display: entry.timelineDisplay ?? {},
    marker: entry.timelineMarker,
    direction: entry.direction,
    occurredAt: entry.occurredAt.toISOString(),
    companyId: entry.companyId,
    personId: entry.personId,
    dealId: entry.dealId,
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/account-timeline — Company or Deal timeline
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/account-timeline', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = accountTimelineQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { rootType, rootId, occurredFrom, occurredTo, limit, sourceType, direction, personId, dealId, cursor } = parsed.data

    if ((occurredFrom === undefined) !== (occurredTo === undefined)) {
      return void res.status(400).json({ error: 'occurredFrom and occurredTo must be supplied together.' })
    }
    if (occurredFrom && occurredTo && occurredTo <= occurredFrom) {
      return void res.status(400).json({ error: 'occurredTo must be after occurredFrom.' })
    }
    if (rootType === 'deal' && (personId || dealId)) {
      return void res.status(400).json({ error: 'personId and dealId filters are available only on a company timeline.' })
    }
    const decodedCursor = cursor ? decodeTimelineCursor(cursor) : null
    if (cursor && !decodedCursor) {
      return void res.status(400).json({ error: 'cursor is invalid.' })
    }
    // --- Verify ownership ---
    const companyRoot =
      rootType === 'company'
        ? await prisma.company.findFirst({
            where: { id: rootId, orgId, deletedAt: null },
            select: { id: true, createdAt: true },
          })
        : null
    const dealRoot =
      rootType === 'deal'
        ? await prisma.deal.findFirst({
            where: { id: rootId, orgId, deletedAt: null },
            select: { id: true, createdAt: true, status: true, closeDate: true },
          })
        : null
    const root = companyRoot ?? dealRoot
    if (!root) return void res.status(404).json({ error: 'Account not found' })

    const rootWhere: Prisma.ActivityEntryWhereInput = {
      orgId,
      ...(rootType === 'company' ? { companyId: rootId } : { dealId: rootId }),
    }

    // A caller that chooses a range gets it verbatim. Without one, a small scalar
    // probe and the root's open-deal facts choose a durable server default; neither
    // query is the event page below, which remains one indexed ActivityEntry read.
    const isDefaultRange = !occurredFrom
    const range =
      occurredFrom && occurredTo
        ? { from: occurredFrom, to: occurredTo }
        : await (async () => {
            const recentEvents = await prisma.activityEntry.findMany({
              where: rootWhere,
              orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
              take: DENSE_TIMELINE_EVENT_COUNT,
              select: { id: true },
            })
            const activeDeal =
              rootType === 'company'
                ? await prisma.deal.findFirst({
                    where: { orgId, companyId: rootId, status: 'open', deletedAt: null },
                    orderBy: [{ closeDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
                    select: { createdAt: true, closeDate: true },
                  })
                : dealRoot?.status === 'open'
                  ? { createdAt: dealRoot.createdAt, closeDate: dealRoot.closeDate }
                  : null
            return resolveSmartTimelineRange({
              accountCreatedAt: root.createdAt,
              activeDealCreatedAt: activeDeal?.createdAt ?? null,
              farthestCommitmentAt: activeDeal?.closeDate ?? null,
              recentEventCount: recentEvents.length,
              now: new Date(),
            })
          })()

    // --- Build filters ---
    const where: Prisma.ActivityEntryWhereInput = {
      orgId,
      ...(rootType === 'company' ? { companyId: rootId } : { dealId: rootId }),
      ...(rootType === 'company' && personId ? { personId } : {}),
      ...(rootType === 'company' && dealId ? { dealId } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(direction ? { direction } : {}),
      occurredAt: { gte: range.from, lt: range.to },
      ...(decodedCursor
        ? {
            AND: [
              {
                OR: [
                  { occurredAt: { lt: decodedCursor.occurredAt } },
                  { occurredAt: decodedCursor.occurredAt, id: { lt: decodedCursor.id } },
                ],
              },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    // One scoped ActivityEntry range query. No include/select relation expansion
    // means a timeline page cannot regress into per-event source reads.
    const rows = await prisma.activityEntry.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows

    // --- Return response ---
    res.json({
      events: pageRows.map(mapTimelineEventToApi),
      nextCursor: hasMore ? encodeTimelineCursor(pageRows[pageRows.length - 1]) : null,
      range: { from: range.from.toISOString(), to: range.to.toISOString(), isDefault: isDefaultRange },
    })
  }),
)

export default router
