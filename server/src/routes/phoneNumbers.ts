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
import { queueProvisionNumber } from '../jobs/provisionNumber.js'
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

// --- Purchase input ---

/**
 * E.164, strictly: a leading `+`, a country code that cannot start with 0, and
 * 7 to 15 digits in all — 15 is the standard's ceiling, and 7 is about the
 * shortest any country issues.
 *
 * Strict because this check is the last thing standing between a typo and a
 * purchase. Nothing is normalised on the way through — no stripping of spaces,
 * dashes or brackets — because reshaping what someone typed can turn a typo
 * into a DIFFERENT number that is perfectly valid, and then we buy that one and
 * rent it every month. Anything not already in E.164 is refused, and the
 * message says what E.164 looks like.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/

const purchaseBodySchema = z.object({
  e164: z
    .string({ error: 'Pick a number to buy, and send it as e164.' })
    .trim()
    .regex(
      E164_PATTERN,
      'Enter the number in E.164 form — a plus, the country code, then digits, like +12025550123.',
    ),
})

/**
 * The statuses that mean "this org already holds this number".
 *
 * Every status except "failed". A "searching" row has a purchase in flight, an
 * "active" one is bought and dialable, and a "releasing" one is still rented
 * until Twilio says otherwise — buying any of them again rents a SECOND number
 * at the same monthly price, and nothing downstream would notice.
 *
 * "failed" is deliberately absent: a failed row is a purchase that never
 * happened, and someone clicking buy again is retrying precisely because of it.
 * Treating it as ownership would strand them on a number they can see, do not
 * have, and can never ask for again.
 */
const OWNED_STATUSES = ['searching', 'active', 'releasing']

// Says "your organization", not "you", because the check is org-wide: the org
// owns a number and merely assigns it to a member, so a colleague holding it
// already counts. It names no colleague — the number is the org's, the person is
// not this route's to disclose.
const ALREADY_OWNED_ERROR = 'Your organization already has this number. Pick a different one.'

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
// POST /api/orgs/:orgId/phone-numbers — buy one of them
// ============================================================
// This route does NOT call Twilio. It writes a "searching" row, hands the
// purchase to the provisioning job, and answers straight away: buying a number
// is seconds of Twilio round-trip, and someone who has just clicked "buy" should
// get their row back and watch it turn active rather than hold a request open
// waiting on a third party. src/jobs/provisionNumber.ts is the only thing in
// this flow that spends money, and it is deliberately not here.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/phone-numbers', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    // First, exactly as in the sibling routes: a non-member must not be able to
    // queue a purchase against this org, and must not be able to tell a 400 from
    // a 404 and so map which orgs exist.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = purchaseBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { e164 } = parsed.data

    // --- Verify ownership: of the number, this time ---
    // Org-wide rather than per-user, because the org is what owns a number and a
    // member is only who it is assigned to. Other orgs are NOT consulted: this
    // app cannot read another tenant's rows without breaking the boundary that
    // makes it multi-tenant, and it does not need to — Twilio will not sell the
    // same number twice, and the job turns that refusal into a "failed" row.
    // There is no unique index on `e164` to lean on, so this read is the check;
    // two simultaneous buys of the same number can still both pass it, and the
    // second one loses at Twilio rather than here.
    const owned = await prisma.phoneNumber.findFirst({
      where: { orgId, e164, status: { in: OWNED_STATUSES } },
      select: { id: true },
    })
    if (owned) {
      return void res.status(409).json({ error: ALREADY_OWNED_ERROR })
    }

    // --- Execute query ---
    // The row FIRST, then the job — never the other way round. The job acts only
    // on a row that is still "searching", so a job enqueued ahead of its row
    // finds nothing to buy and settles as a no-op, and the purchase is lost with
    // a 201 already sent.
    //
    // status and isActiveForOutbound are written out rather than left to the
    // schema defaults: this response PROMISES both values, and a default that
    // drifted would make the promise false without this file changing. orgId
    // comes from the path and assignedUserId from the verified caller — neither
    // is ever read off the body, whatever the body claims.
    const created = await prisma.phoneNumber.create({
      data: {
        orgId,
        assignedUserId: userId,
        e164,
        status: 'searching',
        isActiveForOutbound: false,
      },
    })

    try {
      await queueProvisionNumber(created.id)
    } catch (error) {
      // This is NOT the hand-rolled try/catch the route rules forbid. Nothing is
      // swallowed: the rethrow below leaves wrapRoute owning the log, the report
      // and the 500. What this block does is undo a half-finished write.
      //
      // A "searching" row with no job behind it is the worst state to walk away
      // from: the list screen spins on it forever, and the ownership check above
      // would then refuse every retry of that number. "failed" is honest about
      // what happened, is the same status the job writes when a purchase cannot
      // be made, and is the one status a retry is let through. The row is kept
      // rather than deleted so the attempt stays visible to anyone reading the
      // table afterwards.
      //
      // Compare-and-set on `status: "searching"`, scoped by orgId, so it can
      // only touch the row just written and only while nothing else has settled
      // it.
      try {
        await prisma.phoneNumber.updateMany({
          where: { id: created.id, orgId, status: 'searching' },
          data: { status: 'failed' },
        })
      } catch (cleanupError) {
        // The database is a likely reason the enqueue failed at all, so this
        // failing too is expected rather than surprising. Log it, and let the
        // ORIGINAL error be the one that reaches wrapRoute.
        logger.error(
          { orgId, userId, phoneNumberId: created.id, error: cleanupError },
          'could not mark an unqueued phone number failed',
        )
      }
      throw error
    }

    // Identifiers only. The number itself is not logged: it is a phone number,
    // which is PII, and the row id is enough to find it.
    logger.info({ orgId, userId, phoneNumberId: created.id }, 'queued a phone number purchase')

    // --- Return response ---
    // 201: the PhoneNumber record exists now, even though Twilio has not sold
    // anything yet. It comes back through the same mapper the list route uses,
    // so the row the client just created is shaped exactly like the rows it will
    // poll — status "searching" until the job turns it active.
    res.status(201).json({ number: mapPhoneNumberToApi(created) })
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
