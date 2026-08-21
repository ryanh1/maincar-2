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

// --- Activation input ---

// The one status a number can be dialed from. The others mean "not bought yet"
// ("searching"), "on its way out" ("releasing"), or "the purchase failed"
// ("failed") — none of them can carry a call.
const ACTIVE_STATUS = 'active'

// The same wording whether the id is nonsense, belongs to a colleague, or lives
// in another org. Three answers would let a caller map what they cannot see.
const NOT_FOUND_ERROR = 'Phone number not found'

const DEACTIVATE_ERROR =
  'To stop calling from this number, make a different one active instead. Switching this one off would leave you with no caller ID and no way to place a call.'

// Thrown inside the transaction so a failed check rolls the writes back with it.
// Classes rather than sentinel strings because the second one carries a value
// the response has to name.
class NumberNotFound extends Error {}
class NumberNotReady extends Error {
  constructor(readonly actualStatus: string) {
    super('phone number not active')
  }
}

// Only the one field, and only a boolean. `false` is parsed, not rejected here,
// so the route can answer it with a message that says what to do instead.
const activationBodySchema = z.object({
  isActiveForOutbound: z.boolean({
    error: 'Send isActiveForOutbound as true or false.',
  }),
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

// ============================================================
// PATCH /api/orgs/:orgId/phone-numbers/:id — choose the outbound caller ID
// ============================================================
// This is a radio button, not a checkbox: picking one number is what un-picks
// the rest, so the whole route is "make THIS one the active one".
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/phone-numbers/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    // Before the body is read, and before the row is looked up: a non-member
    // must not learn whether this org — or this number — exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = activationBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // `false` is refused on purpose rather than silently doing nothing. Turning
    // the active number off leaves the user with no caller ID and no way to
    // place a call, and nothing in the UI would explain why dialing stopped
    // working — so the only supported way out of a number is into another one.
    // Releasing a number is a separate act, and goes through its own route.
    if (!parsed.data.isActiveForOutbound) {
      return void res.status(400).json({ error: DEACTIVATE_ERROR })
    }

    // --- Execute query ---
    // One transaction, and the row is READ inside it: the check that the number
    // is provisioned, the un-picking of the others, and the picking of this one
    // must all see the same instant. A crash between the two writes would
    // otherwise leave the user with zero active numbers, or with two.
    let target: PhoneNumber
    try {
      target = await prisma.$transaction(async (tx) => {
        // All three keys: orgId is the tenant boundary, assignedUserId is
        // "mine". A colleague's number, or another org's, is simply not found.
        const found = await tx.phoneNumber.findFirst({
          where: { id, orgId, assignedUserId: userId },
        })
        if (!found) throw new NumberNotFound()
        // A number still being bought has no Twilio SID to call from, so
        // activating it would produce a caller ID that does not exist yet.
        if (found.status !== ACTIVE_STATUS) throw new NumberNotReady(found.status)

        // Scoped to this user in this org, so switching caller ID never touches
        // a colleague's numbers. Filtered to the rows that are actually on, so
        // the ones already off keep their `updatedAt` and stay readable as
        // untouched in an audit. If the data is ever broken with two active,
        // this clears both.
        await tx.phoneNumber.updateMany({
          where: { orgId, assignedUserId: userId, isActiveForOutbound: true, id: { not: id } },
          data: { isActiveForOutbound: false },
        })

        // updateMany with the tenant keys, never update by id: the where clause
        // carries the boundary even if the check above were ever bypassed.
        const activated = await tx.phoneNumber.updateMany({
          where: { id, orgId, assignedUserId: userId },
          data: { isActiveForOutbound: true },
        })
        if (activated.count === 0) throw new NumberNotFound()

        // The row just read, with the one field this route writes. Every field
        // the mapper sends is either unchanged or set right here, so this cannot
        // disagree with what was stored — and it costs no extra read.
        return { ...found, isActiveForOutbound: true }
      })
    } catch (error) {
      if (error instanceof NumberNotFound) {
        return void res.status(404).json({ error: NOT_FOUND_ERROR })
      }
      if (error instanceof NumberNotReady) {
        // The actual status is named so someone waiting on provisioning learns
        // why, instead of being told "no" twice.
        return void res.status(400).json({
          error: `This number is not ready to call from yet — it is ${error.actualStatus}. Pick a number that is active.`,
        })
      }
      throw error
    }

    logger.info({ orgId, userId, phoneNumberId: id }, 'activated a number for outbound calling')

    // --- Return response ---
    res.json({ number: mapPhoneNumberToApi(target) })
  }),
)

export default router
