/**
 * Meeting routes — READ ONLY (MAI-139, T11; spec §6, plan T11).
 *
 * Mounted at /api/orgs/:orgId/meetings. The org lives in the path, never the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route requires auth and an active membership in the org
 * named by the path, and every query carries the orgId filter.
 *
 * READ ONLY, on purpose. Creating a meeting, and the Google Calendar / Microsoft
 * Graph sync that will write these rows, are a LATER spec — this ticket lands the
 * tables and the way back out of them. There is deliberately no POST/PATCH/DELETE
 * here: a half-built "schedule" route that looks live is worse than no route at
 * all (CLAUDE.md → Verification before finishing).
 *
 * WHAT THIS FILE MUST NEVER DO: reach for a token. Calendar credentials live on
 * OAuthConnection, owned by the Integration Hub. A Meeting carries provider ids
 * and nothing else, and this router never joins toward a grant.
 *
 * TIMES. Every timestamp leaves through server/src/crm/meetingActivity.ts, which
 * is the one place that decides how an all-day meeting differs from a timed one
 * on the wire (CLAUDE.md → Dates & Times). This router does no formatting itself.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  CONFERENCE_PROVIDERS,
  MEETING_PROVIDERS,
  MEETING_STATUSES,
  mapMeetingToDetailApi,
  mapMeetingToListApi,
} from '../crm/meetingActivity.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25

// 100, the same ceiling the call history, the email list, and the message list
// use: a list is read a page at a time, and past a hundred rows the payload is
// bandwidth nobody scrolls through. A caller asking for more is capped rather
// than refused.
export const LIST_MAX_LIMIT = 100

// The columns a meeting list may sort on. Each token IS the Prisma field name it
// orders by, so the orderBy is built straight from the parsed value with no
// second mapping to drift — and the enum is the allowlist that stops an arbitrary
// column name reaching the query.
const SORT_FIELDS = ['startsAt', 'endsAt', 'createdAt', 'title'] as const

/**
 * An untouched optional query param arrives as `""`. For a search that means "no
 * filter", not a value to match, so it collapses to undefined rather than
 * filtering for titles containing the empty string (which is all of them, but
 * says the wrong thing).
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

// A boolean that arrives as a query string. "true"/"false" only: an unparseable
// value is a 400 rather than a silent `false`, which would quietly answer a
// different question than the one asked.
const optionalBool = z.preprocess(
  blankToUndefined,
  z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
)

// Query-string params, so every value coerces from a string. Bounds are clamped
// and each field defaults, so a bare `GET …/meetings` is valid and returns page one.
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z.enum(SORT_FIELDS, { error: `Sort by one of: ${SORT_FIELDS.join(', ')}.` }).default('startsAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),

  // Roll-up filters — the Company and Deal feeds.
  companyId: optionalId,
  dealId: optionalId,
  // The series a recurring instance belongs to.
  recurringEventId: optionalId,

  status: z
    .enum(MEETING_STATUSES, { error: `status is one of: ${MEETING_STATUSES.join(', ')}.` })
    .optional(),
  provider: z
    .enum(MEETING_PROVIDERS, { error: `provider is one of: ${MEETING_PROVIDERS.join(', ')}.` })
    .optional(),
  conferenceProvider: z
    .enum(CONFERENCE_PROVIDERS, {
      error: `conferenceProvider is one of: ${CONFERENCE_PROVIDERS.join(', ')}.`,
    })
    .optional(),

  isAllDay: optionalBool,

  // "Was it in a room?" and "was it a video call?" are two separate questions,
  // and they are separately answerable precisely BECAUSE location and joinUrl are
  // two columns. A merged "where" string could answer neither.
  hasLocation: optionalBool,
  hasJoinUrl: optionalBool,

  // Attendee filters. BOTH are here and they are not redundant: a Person may hold
  // several addresses, and an address may belong to nobody at all. Filtering by
  // personId finds the meetings with someone in the CRM; filtering by email finds
  // the meetings with an EXTERNAL attendee, which is the case this whole model
  // exists to make possible.
  personId: optionalId,
  email: z.preprocess(
    blankToUndefined,
    z.string().trim().toLowerCase().max(320, 'That address is too long to be one.').optional(),
  ),

  // The calendar window. Half-open [startsFrom, startsTo): a month view asks for
  // the 1st to the 1st of the next month and must not double-count a meeting
  // sitting exactly on the boundary.
  startsFrom: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  startsTo: z.preprocess(blankToUndefined, z.coerce.date().optional()),

  // Free text over the title, the description, and the location. The location IS
  // searchable — "which meetings were at the Chicago office?" is a question a
  // physical location column exists to answer.
  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/meetings — the org's meeting list
// ============================================================
// Paginated, sortable, and filterable by account, deal, series, status, provider,
// conference provider, all-day, room-vs-video, attendee, date window, and free
// text. Scoped to the org in the path and nothing narrower: like the call history,
// the calendar log is the org's shared record of what happened. The count and the
// page are read against the SAME where clause, so `total` and the rows can never
// describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/meetings', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Before any row is read: a non-member must not see this org's meetings, and
    // must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const {
      page,
      limit,
      sort,
      dir,
      companyId,
      dealId,
      recurringEventId,
      status,
      provider,
      conferenceProvider,
      isAllDay,
      hasLocation,
      hasJoinUrl,
      personId,
      email,
      startsFrom,
      startsTo,
      q,
    } = parsed.data

    if (startsFrom && startsTo && startsTo < startsFrom) {
      return void res.status(400).json({ error: 'startsTo must not be before startsFrom.' })
    }

    // --- Build filters ---
    // orgId is the tenant boundary, always, and it is repeated INSIDE the nested
    // attendee filter too: a related-row condition is its own query, and a `some`
    // without orgId would reach across tenants to decide which of this org's rows
    // match.
    const attendeeFilters: Prisma.MeetingAttendeeWhereInput[] = []
    if (personId) attendeeFilters.push({ orgId, personId })
    if (email) attendeeFilters.push({ orgId, email: { equals: email, mode: 'insensitive' } })

    // Half-open window: gte the lower bound, lt the upper.
    const startsAtRange =
      startsFrom || startsTo
        ? { ...(startsFrom ? { gte: startsFrom } : {}), ...(startsTo ? { lt: startsTo } : {}) }
        : undefined

    const where: Prisma.MeetingWhereInput = {
      orgId,
      ...(companyId ? { companyId } : {}),
      ...(dealId ? { dealId } : {}),
      ...(recurringEventId ? { recurringEventId } : {}),
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      ...(conferenceProvider ? { conferenceProvider } : {}),
      ...(isAllDay === undefined ? {} : { isAllDay }),
      ...(hasLocation === undefined ? {} : { location: hasLocation ? { not: null } : null }),
      ...(hasJoinUrl === undefined ? {} : { joinUrl: hasJoinUrl ? { not: null } : null }),
      ...(startsAtRange ? { startsAt: startsAtRange } : {}),
      ...(attendeeFilters.length > 0
        ? { AND: attendeeFilters.map((some) => ({ attendees: { some } })) }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
              { location: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    // Count and page in parallel against one where clause. The sort is the
    // caller's chosen column with createdAt as a stable tie-break, so rows that
    // share a timestamp keep a deterministic order across pages rather than
    // shuffling between requests. When the sort already IS createdAt the tie-break
    // would just repeat it, so it is dropped.
    //
    // No `nulls: 'last'` dance here, unlike the email and message lists: startsAt
    // and endsAt are NOT NULL on this table. A meeting without a time is not a
    // meeting.
    const orderBy: Prisma.MeetingOrderByWithRelationInput[] =
      sort === 'createdAt' ? [{ createdAt: dir }] : [{ [sort]: dir }, { createdAt: 'desc' as const }]

    const [total, meetings] = await Promise.all([
      prisma.meeting.count({ where }),
      prisma.meeting.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        // The attendee ROWS are not loaded with the page — a calendar row needs a
        // headcount, not six names — but the count is, so a row can say "6
        // attendees" without a query apiece. That is the N+1 this replaces.
        include: { _count: { select: { attendees: true } } },
      }),
    ])

    // --- Return response ---
    res.json({ meetings: meetings.map(mapMeetingToListApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/meetings/:id — one meeting, in full
// ============================================================
// The whole record: the description, the room AND the video link, the calendar
// deep link, and every attendee — the external ones included, with the address
// they were actually invited at. Scoped to the org in the path — a meeting in
// another org, or one that does not exist, is answered 404 the same way, so this
// route never confirms the existence of a row it must not reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/meetings/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // id AND orgId together, never id alone: the tenant key is half the lookup, so
    // a real id belonging to another org matches nothing and falls to the 404
    // below. Org isolation lives in the where clause, not in a check bolted on
    // after the read.
    const meeting = await prisma.meeting.findFirst({
      where: { id, orgId },
      // Organizer first, then by address — a stable order, so the attendee list
      // does not reshuffle between requests.
      include: {
        attendees: { orderBy: [{ isOrganizer: 'desc' }, { email: 'asc' }] },
      },
    })
    if (!meeting) {
      return void res.status(404).json({ error: 'Meeting not found' })
    }

    // --- Return response ---
    res.json({ meeting: mapMeetingToDetailApi(meeting) })
  }),
)

export default router
