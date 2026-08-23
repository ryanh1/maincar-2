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
import { mapEmailToDetailApi } from '../crm/emailActivity.js'
import { mapMeetingToDetailApi } from '../crm/meetingActivity.js'
import { mapSmsToDetailApi } from '../crm/smsActivity.js'
import { mapNoteToApi, mapTaskToApi } from '../crm/taskNote.js'
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
  mine: z.preprocess(
    blankToUndefined,
    z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  ),
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

/**
 * Reads the source only AFTER the ActivityEntry has proved its organization and
 * account scope. The feed remains the ordering projection; this is the one
 * deliberate follow-up read that supplies source-authoritative panel content.
 */
async function readTimelineDetail(entry: { sourceType: string; sourceId: string; orgId: string; timelineMarker: Prisma.JsonValue | null }) {
  const { orgId, sourceId } = entry
  switch (entry.sourceType) {
    case 'call': {
      const call = await prisma.call.findFirst({ where: { id: sourceId, orgId } })
      return call && {
        type: 'call', id: call.id, direction: call.direction, status: call.status,
        fromE164: call.fromE164, toE164: call.toE164, recordingEnabled: call.recordingEnabled,
        transcriptStatus: call.transcriptStatus, transcript: call.transcript, durationS: call.durationS,
        startedAt: call.startedAt?.toISOString() ?? null, endedAt: call.endedAt?.toISOString() ?? null,
        createdAt: call.createdAt.toISOString(), openFullCallPath: `/calls/${call.id}`,
      }
    }
    case 'email': {
      const email = await prisma.email.findFirst({
        where: { id: sourceId, orgId },
        include: { participants: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }, attachments: { orderBy: [{ createdAt: 'asc' }] } },
      })
      return email && { type: 'email', ...mapEmailToDetailApi(email) }
    }
    case 'sms': {
      const message = await prisma.smsMessage.findFirst({
        where: { id: sourceId, orgId }, include: { media: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      })
      return message && { type: 'sms', ...mapSmsToDetailApi(message) }
    }
    case 'meeting': {
      const meeting = await prisma.meeting.findFirst({
        where: { id: sourceId, orgId }, include: { attendees: { orderBy: [{ createdAt: 'asc' }] } },
      })
      return meeting && { type: 'meeting', ...mapMeetingToDetailApi(meeting) }
    }
    case 'note': {
      const note = await prisma.note.findFirst({ where: { id: sourceId, orgId, deletedAt: null } })
      return note && { type: 'note', ...mapNoteToApi(note) }
    }
    case 'task': {
      const task = await prisma.task.findFirst({ where: { id: sourceId, orgId, deletedAt: null } })
      if (!task) return null
      const { type: taskType, ...taskDetail } = mapTaskToApi(task)
      return { type: 'task', taskType, ...taskDetail }
    }
    case 'stage_change': {
      // A stage change's source id is an immutable transition identity, not a
      // FieldHistory primary key. Its stored marker is therefore the durable
      // before/after evidence; confirming the current Deal still exists prevents
      // a stale projection from rendering as a live detail.
      const dealId = sourceId.split(':', 1)[0]
      const deal = dealId ? await prisma.deal.findFirst({ where: { id: dealId, orgId, deletedAt: null } }) : null
      return deal && { type: 'stage_change', id: sourceId, dealId: deal.id, marker: entry.timelineMarker }
    }
    case 'record_created': {
      // Creation rows use the created record's id. It may be a Company, Person,
      // or Deal; probe each org-scoped root without ever accepting a cross-org id.
      const [company, person, deal] = await Promise.all([
        prisma.company.findFirst({ where: { id: sourceId, orgId, deletedAt: null } }),
        prisma.person.findFirst({ where: { id: sourceId, orgId, deletedAt: null } }),
        prisma.deal.findFirst({ where: { id: sourceId, orgId, deletedAt: null } }),
      ])
      const record = company ?? person ?? deal
      return record && { type: 'record_created', id: sourceId }
    }
    case 'custom': {
      const record = await prisma.record.findFirst({ where: { id: sourceId, orgId, deletedAt: null } })
      return record && { type: 'custom', id: record.id, values: record.valuesJson }
    }
    default:
      return null
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
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = accountTimelineQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { rootType, rootId, occurredFrom, occurredTo, limit, sourceType, direction, personId, dealId, mine, cursor } = parsed.data

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
      ...(mine ? { createdByUserId: userId } : {}),
    }

    // A caller that chooses a range gets it verbatim. Without one, small indexed
    // ActivityEntry probes and the root's open-deal facts choose a durable server
    // default; the event page below remains one indexed ActivityEntry read.
    const isDefaultRange = !occurredFrom
    const range =
      occurredFrom && occurredTo
        ? { from: occurredFrom, to: occurredTo }
        : await (async () => {
            const activeDeal =
              rootType === 'company'
                ? await prisma.deal.findFirst({
                    where: { orgId, companyId: rootId, status: 'open', deletedAt: null },
                    orderBy: [{ createdAt: 'asc' }],
                    select: { createdAt: true },
                  })
                : dealRoot?.status === 'open'
                  ? { createdAt: dealRoot.createdAt }
                  : null
            const now = new Date()
            const farthestScheduledActivity = await prisma.activityEntry.findFirst({
              where: {
                ...rootWhere,
                sourceType: { in: ['call', 'meeting', 'task'] },
                timelineSubtype: 'scheduled',
                occurredAt: { gt: now },
              },
              orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
              select: { occurredAt: true },
            })
            const recentEvents = activeDeal
              ? []
              : await prisma.activityEntry.findMany({
                  where: { ...rootWhere, occurredAt: { lte: now } },
                  orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
                  take: DENSE_TIMELINE_EVENT_COUNT,
                  select: { occurredAt: true },
                })
            return resolveSmartTimelineRange({
              accountCreatedAt: root.createdAt,
              activeDealCreatedAt: activeDeal?.createdAt ?? null,
              farthestScheduledAt: farthestScheduledActivity?.occurredAt ?? null,
              recentEventOccurredAt: recentEvents.map((event) => event.occurredAt),
              now,
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
      ...(mine ? { createdByUserId: userId } : {}),
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

// ============================================================
// GET /api/orgs/:orgId/account-timeline/:eventId — one typed detail panel
// ============================================================
router.get(
  '/:eventId',
  wrapRoute('GET /api/orgs/:orgId/account-timeline/:eventId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const eventId = String(req.params.eventId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = accountTimelineQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const { rootType, rootId, occurredFrom, occurredTo, sourceType, direction, personId, dealId, mine } = parsed.data
    if ((occurredFrom === undefined) !== (occurredTo === undefined)) {
      return void res.status(400).json({ error: 'occurredFrom and occurredTo must be supplied together.' })
    }
    if (occurredFrom && occurredTo && occurredTo <= occurredFrom) {
      return void res.status(400).json({ error: 'occurredTo must be after occurredFrom.' })
    }
    if (rootType === 'deal' && (personId || dealId)) {
      return void res.status(400).json({ error: 'personId and dealId filters are available only on a company timeline.' })
    }

    // --- Verify ownership ---
    const root = rootType === 'company'
      ? await prisma.company.findFirst({ where: { id: rootId, orgId, deletedAt: null }, select: { id: true } })
      : await prisma.deal.findFirst({ where: { id: rootId, orgId, deletedAt: null }, select: { id: true } })
    if (!root) return void res.status(404).json({ error: 'Account not found' })

    // --- Execute query ---
    // Scope before dispatch. A guessed ActivityEntry id cannot select a source in
    // another account or organization, even when its source id is valid there.
    const scopedWhere: Prisma.ActivityEntryWhereInput = {
        id: eventId, orgId,
        ...(rootType === 'company' ? { companyId: rootId } : { dealId: rootId }),
        ...(rootType === 'company' && personId ? { personId } : {}),
        ...(rootType === 'company' && dealId ? { dealId } : {}),
        ...(sourceType ? { sourceType } : {}),
        ...(direction ? { direction } : {}),
        ...(mine ? { createdByUserId: userId } : {}),
        ...(occurredFrom && occurredTo ? { occurredAt: { gte: occurredFrom, lt: occurredTo } } : {}),
      }
    const entry = await prisma.activityEntry.findFirst({ where: scopedWhere })
    if (!entry) return void res.status(404).json({ error: 'Timeline event not found' })

    const detail = await readTimelineDetail(entry)
    if (!detail) return void res.status(404).json({ error: 'Timeline event source not found' })

    const { id: _eventId, ...activeFilterWhere } = scopedWhere
    const [previous, next] = await Promise.all([
      prisma.activityEntry.findFirst({
        where: { ...activeFilterWhere, OR: [{ occurredAt: { gt: entry.occurredAt } }, { occurredAt: entry.occurredAt, id: { gt: entry.id } }] },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { id: true },
      }),
      prisma.activityEntry.findFirst({
        where: { ...activeFilterWhere, OR: [{ occurredAt: { lt: entry.occurredAt } }, { occurredAt: entry.occurredAt, id: { lt: entry.id } }] },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { id: true },
      }),
    ])

    // --- Return response ---
    res.json({
      event: mapTimelineEventToApi(entry),
      detail,
      navigation: { previousEventId: previous?.id ?? null, nextEventId: next?.id ?? null },
    })
  }),
)

export default router
