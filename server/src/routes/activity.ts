/**
 * Activity feed route — READ ONLY (MAI-140, T12; spec §5.11a / §6, plan T12).
 *
 * Mounted at /api/orgs/:orgId/activity. The org lives in the path, never the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a request
 * touches (server/src/middleware/auth.ts explains why it is kept off the verified
 * caller). Every route requires auth and an active membership in the org named by
 * the path, and every query carries the orgId filter.
 *
 * THIS ROUTE IS THE ACCEPTANCE CRITERION. A Company page's feed must be ONE indexed
 * query — no joins, no union across five activity tables, no second round-trip.
 * Two decisions below are what make that literally true, and neither is a style
 * choice:
 *
 *   1. NO `include`, NO `select` reaching a relation. The handler reads ActivityEntry
 *      and nothing else. Every field a row renders is ON the row — that is what the
 *      denormalization bought, and joining back to Company or User here would hand
 *      the cost straight back.
 *   2. NO COUNT. The other list routes in this repo pair a `findMany` with a
 *      `count` to report `total`, and that is two queries. A feed is scrolled, not
 *      paged to the end, so this one asks for `limit + 1` rows and reports
 *      `hasMore` instead. One statement, one index range scan.
 *
 * At most ONE spine scope (companyId / personId / dealId) per request, enforced
 * below. It is not an arbitrary restriction: each scope has its own composite index
 * ending in `occurredAt`, and combining two would leave the planner filtering one
 * index's range by the other column — the exact "it used to be fast" regression this
 * table exists to prevent. Ask for the account feed or the deal feed, not both.
 *
 * READ ONLY, on purpose. Feed rows are never written by a client: they are written
 * by whatever wrote the underlying activity, inside that activity's own transaction
 * (server/src/crm/activityFeed.ts). A POST here would be a way to put a line in the
 * feed that no call, email, or meeting stands behind.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  ACTIVITY_DIRECTIONS,
  ACTIVITY_SOURCE_TYPES,
  mapActivityToApi,
} from '../crm/activityFeed.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here — which
// would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const FEED_DEFAULT_LIMIT = 25

// 100, the same ceiling the call history, the email list, the message list, and the
// meeting list use: a feed is read a page at a time, and past a hundred rows the
// payload is bandwidth nobody scrolls through. A caller asking for more is capped
// rather than refused.
export const FEED_MAX_LIMIT = 100

export const ONE_SCOPE_ERROR =
  'Ask for one feed at a time: companyId, personId, or dealId — not more than one.'

/**
 * An untouched optional query param arrives as `""`. For a filter that means "no
 * filter", not a value to match, so it collapses to undefined rather than narrowing
 * to rows whose companyId is the empty string (which is none of them, but says the
 * wrong thing).
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
  z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
)

// Query-string params, so every value coerces from a string. Bounds are clamped and
// each field defaults, so a bare `GET …/activity` is valid and returns page one of
// the org-wide feed.
const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(FEED_MAX_LIMIT, `Ask for at most ${FEED_MAX_LIMIT} rows at a time.`)
    .default(FEED_DEFAULT_LIMIT),
  // Newest first by default — the only order a feed is ever read in. `asc` exists
  // for "walk this account from the beginning", which is a real thing a rep does
  // when they inherit a book.
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),

  // The spine scopes. At most one — see the module header.
  companyId: optionalId,
  personId: optionalId,
  dealId: optionalId,

  // Both wrapped in blankToUndefined for the same reason the id filters are: a UI
  // that renders these as a <select> with an "All" option sends `sourceType=` when
  // that option is chosen, and "no filter" must not be a 400.
  sourceType: z.preprocess(
    blankToUndefined,
    z
      .enum(ACTIVITY_SOURCE_TYPES, {
        error: `sourceType is one of: ${ACTIVITY_SOURCE_TYPES.join(', ')}.`,
      })
      .optional(),
  ),
  direction: z.preprocess(
    blankToUndefined,
    z
      .enum(ACTIVITY_DIRECTIONS, {
        error: `direction is one of: ${ACTIVITY_DIRECTIONS.join(', ')}.`,
      })
      .optional(),
  ),

  // "Just my activity". A boolean rather than a user id, deliberately: the id it
  // filters on comes from the VERIFIED caller, so this param can never be pointed
  // at a colleague's feed by editing the query string.
  mine: optionalBool,

  // The window, half-open [occurredFrom, occurredTo): a "this month" view asks for
  // the 1st to the 1st of the next month and must not double-count a row sitting
  // exactly on the boundary.
  occurredFrom: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  occurredTo: z.preprocess(blankToUndefined, z.coerce.date().optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/activity — the account, deal, person, or org feed
// ============================================================
// Everything that happened, newest first, in ONE indexed query with no joins. Scope
// it to a Company, a Deal, or a Person with the matching param; leave all three off
// for the org-wide feed. Filterable by activity kind, direction, actor ("just my
// activity"), and a date window.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/activity', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    // Before any row is read: a non-member must not see this org's activity, and
    // must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = feedQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const {
      page,
      limit,
      dir,
      companyId,
      personId,
      dealId,
      sourceType,
      direction,
      mine,
      occurredFrom,
      occurredTo,
    } = parsed.data

    // One scope, so the read lands on exactly one composite index. Two scopes is a
    // 400 rather than a slow success: a query that quietly stops using its index is
    // the failure mode this whole table was built to remove.
    const scopes = [companyId, personId, dealId].filter((v) => v !== undefined)
    if (scopes.length > 1) {
      return void res.status(400).json({ error: ONE_SCOPE_ERROR })
    }

    if (occurredFrom && occurredTo && occurredTo < occurredFrom) {
      return void res.status(400).json({ error: 'occurredTo must not be before occurredFrom.' })
    }

    // --- Build filters ---
    // orgId is the tenant boundary, always, and it leads every one of this table's
    // indexes. The scope column comes next, then the date window on occurredAt —
    // the same order the index is declared in.
    const occurredAtRange =
      occurredFrom || occurredTo
        ? {
            ...(occurredFrom ? { gte: occurredFrom } : {}),
            ...(occurredTo ? { lt: occurredTo } : {}),
          }
        : undefined

    const where: Prisma.ActivityEntryWhereInput = {
      orgId,
      ...(companyId ? { companyId } : {}),
      ...(personId ? { personId } : {}),
      ...(dealId ? { dealId } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(direction ? { direction } : {}),
      // The verified caller's id, never a value off the query string.
      ...(mine ? { createdByUserId: userId } : {}),
      ...(occurredAtRange ? { occurredAt: occurredAtRange } : {}),
    }

    // --- Execute query ---
    // ONE query. No count beside it, no include, no select reaching a relation —
    // see the module header. `limit + 1` rows are read so `hasMore` is answerable
    // without a second statement; the extra row is dropped before the response.
    //
    // `id` is the tie-break, so rows sharing an occurredAt (a backfill stamps a
    // whole batch with the same instant) keep a deterministic order across pages
    // rather than shuffling between requests.
    const rows = await prisma.activityEntry.findMany({
      where,
      orderBy: [{ occurredAt: dir }, { id: dir }],
      skip: (page - 1) * limit,
      take: limit + 1,
    })

    const hasMore = rows.length > limit
    const activity = (hasMore ? rows.slice(0, limit) : rows).map(mapActivityToApi)

    // --- Return response ---
    // `hasMore` rather than `total`: see the module header. A feed is scrolled, and
    // counting the whole history of an account to render one screen is the second
    // query this route refuses to make.
    res.json({ activity, page, limit, hasMore })
  }),
)

export default router
