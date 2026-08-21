/**
 * Phone number routes: the Twilio numbers an org owns and hands to its members.
 *
 * Mounted at /api/orgs/:orgId/phone-numbers. The org lives in the path, not in
 * the caller's `currentOrgId`: that field is a UI preference the client can set,
 * and filtering on it would let a stale preference decide which tenant's rows a
 * request reads (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route below requires authentication and an active
 * membership in the org named by the path.
 *
 * The dialer spec (docs/specs/SPEC-DIALER-REBUILD.md) calls the tenant key
 * `workspaceId` and the path `/workspaces/:workspaceId/phone-numbers`. This
 * codebase has always called it `orgId`, so the path follows suit.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import {
  getLocalNumberMonthlyPrice,
  listAvailableLocalNumbers,
  twilioErrorStatus,
} from '../../dependencies/twilio.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { PhoneNumber } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

// --- Mappers: database row → API shape ---

// assignedUserId and orgId are deliberately absent: the caller already knows
// both (they are the requester and the path), so repeating them adds nothing.
function mapPhoneNumberToApi(number: PhoneNumber) {
  return {
    id: number.id,
    e164: number.e164,
    twilioSid: number.twilioSid,
    status: number.status,
    isActiveForOutbound: number.isActiveForOutbound,
    createdAt: number.createdAt.toISOString(),
  }
}

// --- Search input ---

export const SEARCH_DEFAULT_LIMIT = 20

// 50, not 1000: this feeds a pick-a-number list a person reads. Past a screenful
// or two the extra rows are noise, and every row is one more Twilio pays to list.
export const SEARCH_MAX_LIMIT = 50

// Twilio applies `areaCode` to the North American Numbering Plan only. Asking
// for area code 415 in GB silently returns unrelated numbers, so it is refused.
const AREA_CODE_COUNTRIES = new Set(['US', 'CA'])

/**
 * A form sends an untouched optional field as `""`. That means "no filter", not
 * a bad value, so it must not become a 400 the person cannot act on.
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

// Every message is written to be shown to the person who typed the thing —
// it says what is allowed, not which rule failed.
const searchBodySchema = z
  .object({
    country: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, 'Country must be a two-letter code, like US or CA.')
        .default('US'),
    ),
    areaCode: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .regex(/^\d{3}$/, 'Area code must be three digits, like 415.')
        .optional(),
    ),
    contains: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .regex(
          /^[0-9A-Za-z*]{2,16}$/,
          'Search 2 to 16 letters or digits. Use * to stand for any one character.',
        )
        .optional(),
    ),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Ask for at least one number.')
      .max(SEARCH_MAX_LIMIT, `Ask for at most ${SEARCH_MAX_LIMIT} numbers at a time.`)
      .default(SEARCH_DEFAULT_LIMIT),
  })
  .refine((body) => !body.areaCode || AREA_CODE_COUNTRIES.has(body.country), {
    message: 'Area code search works for US and Canada numbers only.',
    path: ['areaCode'],
  })

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/phone-numbers — the caller's numbers in this org
// ============================================================
// Not paginated on purpose. A user holds a handful of numbers, and this list
// feeds the caller-ID picker, which has to show all of them at once — a page 2
// the picker never asks for would hide a number the user owns.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/phone-numbers', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Build filters ---
    // Both keys, always: orgId is the tenant boundary and assignedUserId is
    // "mine". A number belonging to a colleague is not the caller's to dial from.
    const where = { orgId, assignedUserId: authReq.user!.id }

    // --- Execute query ---
    // Active first, then oldest first, so the number the user actually dials
    // from is row one and the rest keep a stable order between requests.
    const numbers = await prisma.phoneNumber.findMany({
      where,
      orderBy: [{ isActiveForOutbound: 'desc' }, { createdAt: 'asc' }],
    })

    // --- Return response ---
    // activeCount is counted from the rows just read rather than with a second
    // query: one read cannot disagree with itself. The schema allows at most one
    // active number per user, so this is normally 0 or 1 — it is returned as a
    // count so the client can SEE a broken pair rather than pick one at random.
    res.json({
      numbers: numbers.map(mapPhoneNumberToApi),
      total: numbers.length,
      activeCount: numbers.filter((n) => n.isActiveForOutbound).length,
    })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/phone-numbers/search — numbers Twilio has for sale
// ============================================================
// POST, not GET, even though it reads nothing and writes nothing: the search
// criteria are a body rather than a query string, which keeps them out of access
// logs and browser history, and leaves room to grow the filter set without
// growing a URL. Nothing is bought here — this route only looks.
router.post(
  '/search',
  wrapRoute('POST /api/orgs/:orgId/phone-numbers/search', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Before the body is even read: a non-member must not be able to spend this
    // org's Twilio quota, and must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = searchBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { country, areaCode, contains, limit } = parsed.data

    // --- Execute query ---
    // Two Twilio APIs, in parallel, because they are unrelated calls: the
    // available-numbers API lists what is for sale and quotes no price, and the
    // Pricing API quotes the country's monthly rental for the `local` number
    // type. Neither invents anything the other should have said.
    let numbers, price
    try {
      ;[numbers, price] = await Promise.all([
        listAvailableLocalNumbers({ country, areaCode, contains, limit }),
        getLocalNumberMonthlyPrice(country),
      ])
    } catch (error) {
      // This is NOT the hand-rolled try/catch the route rules forbid. It
      // translates ONE Twilio outcome the wrapper cannot see — "no such
      // country" — into the 400 it really is, and rethrows everything else so
      // wrapRoute still owns the logging, the reporting, and the 500.
      const status = twilioErrorStatus(error)
      // Identifiers and criteria only. Never the account SID or the auth token,
      // and never the raw error: wrapRoute logs that through pino's bounded
      // serializer on the rethrow below.
      logger.error(
        { orgId, userId: authReq.user!.id, country, areaCode, twilioStatus: status },
        'Twilio number search failed',
      )
      if (status === 404) {
        return void res
          .status(400)
          .json({ error: `Twilio does not sell phone numbers in ${country}.` })
      }
      throw error
    }

    // --- Return response ---
    // priceMonthly is a decimal STRING ("1.15"), the same text Twilio quoted, so
    // nothing rounds it on the way to the browser. It repeats on every row
    // because it is what each row costs — but it is Twilio's COUNTRY price for a
    // local number, not a per-number quote, because Twilio publishes no such
    // thing. null means Twilio quoted nothing; it is never a stand-in figure.
    // priceUnit is the currency those amounts are in.
    res.json({
      numbers: numbers.map((n) => ({
        e164: n.e164,
        friendly: n.friendly,
        priceMonthly: price.amount,
      })),
      total: numbers.length,
      priceUnit: price.currency,
    })
  }),
)

export default router
