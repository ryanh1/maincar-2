/**
 * Call routes: placing outbound calls, and (in later issues) the history and
 * webhooks that surround them.
 *
 * Mounted at /api/orgs/:orgId/calls. The org lives in the path, not in the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route below requires authentication and an active
 * membership in the org named by the path.
 *
 * This file is the FIRST of the outbound-calling routes. The list, detail,
 * hang-up, and Twilio voice/status webhooks slot in beside the POST below as
 * their own issues; the POST is deliberately the whole of this one.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { initiateOutboundCall, hangUpCall } from '../../dependencies/twilio.js'
import { getRecordingDownloadUrl } from '../../dependencies/s3.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { matchCallToCrm } from '../lib/callMatch.js'
import { activityFromCall, recordActivityInTx } from '../crm/activityFeed.js'
import type { Call } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

// --- Mappers: database row → API shape ---

// orgId and userId are deliberately absent: the caller already knows both (they
// are the requester and the path). twilioCallSid is included because it is null
// on the row this route first writes and set moments later, so the client can
// see which state it got back.
function mapCallToApi(call: Call) {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    fromE164: call.fromE164,
    toE164: call.toE164,
    recordingConsent: call.recordingConsent,
    twilioCallSid: call.twilioCallSid,
    createdAt: call.createdAt.toISOString(),
  }
}

// The history-list shape. It carries everything mapCallToApi does, plus the
// fields a history table shows and sorts on — durationS and the two timestamps —
// which the POST response has no reason to send back (the call has not run yet),
// and transcriptStatus, so the history table's Transcript column reads a real
// value rather than fetching each row's detail. It stops short of the transcript
// TEXT and the signed recording link, which only the detail view needs.
// A separate mapper, not an extended shared one, so the POST contract test that
// pins its exact key set does not have to loosen to admit fields it never sends.
function mapCallToHistoryApi(call: Call) {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    fromE164: call.fromE164,
    toE164: call.toE164,
    recordingConsent: call.recordingConsent,
    transcriptStatus: call.transcriptStatus,
    twilioCallSid: call.twilioCallSid,
    durationS: call.durationS,
    startedAt: call.startedAt ? call.startedAt.toISOString() : null,
    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
    createdAt: call.createdAt.toISOString(),
  }
}

// The single-call detail shape. The whole record a call-detail view shows: every
// field mapCallToHistoryApi carries, plus the three the history table has no use
// for — recordingEnabled, the transcript, and its status — and the signed
// recordingUrl. recordingUrl is NOT the stored column value: the caller passes in
// a freshly signed link (or null), because the stored value is a bare object key.
// orgId and userId stay absent, as in the other mappers — the caller is the
// requester and the org is the path.
function mapCallToDetailApi(call: Call, recordingUrl: string | null) {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    fromE164: call.fromE164,
    toE164: call.toE164,
    recordingConsent: call.recordingConsent,
    recordingEnabled: call.recordingEnabled,
    recordingUrl,
    transcriptStatus: call.transcriptStatus,
    transcript: call.transcript,
    twilioCallSid: call.twilioCallSid,
    durationS: call.durationS,
    startedAt: call.startedAt ? call.startedAt.toISOString() : null,
    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
    createdAt: call.createdAt.toISOString(),
  }
}

// --- Create input ---

/**
 * E.164, strictly: a leading `+`, a country code that cannot start with 0, and
 * 7 to 15 digits in all. The same pattern the number-purchase route uses, and
 * for the same reason — this is the last check before a real call is placed, so
 * nothing is normalised on the way through. Reshaping what someone typed can turn
 * a typo into a DIFFERENT valid number, and then we call that one.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/

const createCallSchema = z.object({
  toE164: z
    .string({ error: 'Enter a number to call, and send it as toE164.' })
    .trim()
    .regex(
      E164_PATTERN,
      'Enter the number in E.164 form — a plus, the country code, then digits, like +12025550123.',
    ),
  // Consent is decided before the call is placed (the greenroom asks), so it is
  // required here rather than defaulted: recording someone without a recorded
  // decision is exactly the mistake this field exists to prevent.
  recordingConsent: z.enum(['granted', 'declined'], {
    error: 'Send recordingConsent as "granted" or "declined".',
  }),
})

// --- List input ---

export const LIST_DEFAULT_LIMIT = 25

// 100, the standard ceiling: a history table is read a page at a time, and past a
// hundred rows the payload is bandwidth nobody scrolls through. A caller asking
// for more is capped rather than refused, so a too-large page still returns.
export const LIST_MAX_LIMIT = 100

// The columns a history list may sort on. Each token is the Prisma field name it
// orders by, so the orderBy is built straight from the parsed value with no
// second mapping to drift — and the enum is the allowlist that stops an arbitrary
// column name reaching the query. `durationS` is the billed-seconds column the
// spec calls "duration".
const SORT_FIELDS = ['createdAt', 'toE164', 'status', 'durationS'] as const

/**
 * An untouched optional query param arrives as `""`. For search that means "no
 * filter", not a value to match, so it collapses to undefined rather than
 * filtering for calls whose number contains the empty string (which is all of
 * them, but says the wrong thing).
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

// Query-string params, so every value coerces from a string. Bounds are clamped,
// not rejected, and each field defaults, so a bare `GET …/calls` is valid and
// returns page one.
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z
    .enum(SORT_FIELDS, {
      error: `Sort by one of: ${SORT_FIELDS.join(', ')}.`,
    })
    .default('createdAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),
  // Matched against the destination number. Digits and a leading + only, so a
  // partial like "201" or "+1201" narrows the list; anything else is refused
  // rather than run as a fruitless LIKE.
  q: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\+?\d{1,15}$/, 'Search by digits of the number, like 201.')
      .optional(),
  ),
})

// The call states that mean "a call is already up". A second call to the same
// number while one of these is in flight is the double-click this route guards
// against. Terminal states (completed, busy, failed, no-answer, canceled) are
// absent on purpose: once a call has ended, dialing the number again is a new,
// wanted call.
const IN_FLIGHT_STATUSES = ['queued', 'ringing', 'in-progress']

// The states in which a call has already ended. Hanging one of these up is a
// no-op the client should be told about rather than a silent success, so the
// hang-up route answers 400 for them. These are exactly the schema's statuses
// that are NOT in flight (server/prisma/schema.prisma → Call.status), so the two
// lists together partition every status a call can hold.
const TERMINAL_STATUSES = ['completed', 'canceled', 'busy', 'failed', 'no-answer']

const ALREADY_ENDED_ERROR = 'This call has already ended, so there is nothing to hang up.'

// The one message for "you have no number to call from". It names what to do,
// not which check failed.
const NO_ACTIVE_NUMBER_ERROR =
  'Activate a phone number for outbound calling before you place a call.'

const DOUBLE_CALL_ERROR =
  'You already have a call to this number in progress. Wait for it to end before calling again.'

// Sentinels thrown inside the transaction so the rollback and the reply agree.
// Classes rather than strings because the double-call case carries the existing
// call the response hands back.
class NoActiveNumber extends Error {}
class DoubleCall extends Error {
  constructor(readonly existing: Call) {
    super('a call to this number is already in flight')
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/calls — the org's call history
// ============================================================
// Paginated, sortable, and searchable by destination number. Scoped to the org
// in the path and nothing narrower: the history is the org's shared record of who
// it called, so any member reading it sees the same list (MAI-27). The count and
// the page are read against the SAME where clause, so `total` and the rows can
// never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/calls', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Before any row is read: a non-member must not see this org's call history,
    // and must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit, sort, dir, q } = parsed.data

    // --- Build filters ---
    // orgId is the tenant boundary, always. q narrows to calls whose destination
    // number contains the typed digits; absent, it adds nothing.
    const where = { orgId, ...(q ? { toE164: { contains: q } } : {}) }

    // --- Execute query ---
    // Count and page in parallel against one where clause. The sort is the
    // caller's chosen column with createdAt as a stable tie-break, so rows that
    // share a status or duration keep a deterministic order across pages rather
    // than shuffling between requests. When the sort already IS createdAt the
    // tie-break would just repeat it, so it is dropped.
    const orderBy =
      sort === 'createdAt' ? [{ createdAt: dir }] : [{ [sort]: dir }, { createdAt: 'desc' as const }]
    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    // --- Return response ---
    res.json({ calls: calls.map(mapCallToHistoryApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/calls/:id — one call, with its transcript
// ============================================================
// The full record for a single call — every field, the transcript, and a freshly
// signed link to the recording. Scoped to the org in the path: a call in another
// org, or one that does not exist, is answered 404 the same way, so this route
// never confirms the existence of a row it must not reveal (MAI-28).
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/calls/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    // Before any row is read: a non-member must not see this org's calls, and must
    // not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // id AND orgId together, never id alone: the tenant key is half the lookup, so
    // a real id belonging to another org matches nothing and falls to the 404
    // below. Org isolation lives in the where clause, not in a check bolted on
    // after the read.
    const call = await prisma.call.findFirst({ where: { id, orgId } })
    if (!call) {
      return void res.status(404).json({ error: 'Call not found' })
    }

    // --- Sign the recording link ---
    // The recordingUrl column holds a bare S3 object KEY, not a link a browser can
    // open. It is signed HERE, at request time, so the URL the client receives is
    // always inside its one-hour life; a link signed once when the recording
    // uploaded and then stored would be expired by the time anyone clicked it. No
    // recording yet → null, not a signed link to nothing.
    const recordingUrl = call.recordingUrl ? await getRecordingDownloadUrl(call.recordingUrl) : null

    // --- Return response ---
    res.json({ call: mapCallToDetailApi(call, recordingUrl) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/calls — place an outbound call
// ============================================================
// Writes a Call row in status "queued", then asks Twilio to dial. The row is
// written first, inside a transaction that holds a lock on the caller's active
// number, so two clicks arriving at once cannot both become calls: the second
// waits for the first to commit, then sees its queued row and is refused.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/calls', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    // Before the body is read: a non-member must not be able to place a call
    // against this org, and must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = createCallSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { toE164, recordingConsent } = parsed.data

    // --- Guard & create, in one transaction ---
    // The caller's active number is read with `FOR UPDATE`, so it is the lock
    // every one of this user's concurrent call attempts contends on. Postgres
    // runs at READ COMMITTED, so without the lock two requests would both read
    // "no call in flight" and both insert. Raw SQL because Prisma cannot express
    // a row lock; parameterised, and orgId/userId come from the verified path and
    // token, never from the body.
    let created: Call
    try {
      created = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; e164: string }[]>`
          SELECT "id", "e164" FROM "PhoneNumber"
          WHERE "orgId" = ${orgId}
            AND "assignedUserId" = ${userId}
            AND "isActiveForOutbound" = true
          FOR UPDATE
        `
        if (locked.length === 0) throw new NoActiveNumber()
        const fromE164 = locked[0].e164

        // In-flight to the SAME number by the SAME user. Scoped to this user so a
        // colleague calling the same number is untouched, and to this org as the
        // tenant boundary. With the lock above held, this count cannot miss a row
        // a racing request is mid-insert.
        const existing = await tx.call.findFirst({
          where: { orgId, userId, toE164, status: { in: IN_FLIGHT_STATUSES } },
        })
        if (existing) throw new DoubleCall(existing)

        // Wire the call into the CRM spine: match the number being dialed against
        // this org's PersonPhone rows and, on a hit, link the person and their
        // company (MAI-132, spec §6). Run inside the transaction so the link is
        // written atomically with the row. An unknown number resolves to all-null
        // links, so the call still logs — the match never blocks a dial.
        const crmLinks = await matchCallToCrm(tx, orgId, toE164)

        // orgId comes from the path and userId from the verified caller — neither
        // is read off the body. status is written out rather than left to the
        // schema default because this response promises it.
        const call = await tx.call.create({
          data: {
            orgId,
            userId,
            fromE164,
            toE164,
            direction: 'outbound',
            status: 'queued',
            recordingConsent,
            personId: crmLinks.personId,
            companyId: crmLinks.companyId,
            dealId: crmLinks.dealId,
          },
        })

        // Append the ONE denormalized feed row for this call (MAI-140, spec
        // §5.11a), so the account page's activity list stays a single indexed
        // query. Inside this transaction, and only ever inside one:
        // recordActivityInTx accepts a Prisma.TransactionClient and nothing else,
        // so a call that rolls back cannot leave a feed row claiming it happened.
        // The write is an upsert on (orgId, sourceType, sourceId), so a re-save
        // refreshes the line instead of appending a second one.
        await recordActivityInTx(tx, activityFromCall(call))

        return call
      })
    } catch (error) {
      if (error instanceof NoActiveNumber) {
        return void res.status(400).json({ error: NO_ACTIVE_NUMBER_ERROR })
      }
      if (error instanceof DoubleCall) {
        // 409, with the call already up, so the client can adopt it rather than
        // believe it started a new one.
        return void res
          .status(409)
          .json({ error: DOUBLE_CALL_ERROR, call: mapCallToApi(error.existing) })
      }
      throw error
    }

    // --- Ask Twilio to dial ---
    // Outside the transaction on purpose: a network round-trip must not hold a
    // row lock open. The Call row already exists, so a failure here is cleaned up
    // by marking it "failed" rather than leaving a phantom "queued" row nothing
    // will ever advance. The Twilio client is injected (dependencies/twilio.ts),
    // so tests exercise this path without a network, an account, or a cent spent.
    try {
      const initiated = await initiateOutboundCall({
        to: toE164,
        from: created.fromE164,
        callId: created.id,
      })

      // Store the SID the status webhook will look the row up by. updateMany with
      // orgId, never update by id: the tenant key carries the boundary.
      await prisma.call.updateMany({
        where: { id: created.id, orgId },
        data: { twilioCallSid: initiated.sid },
      })
      // Reflect the stored SID in the row this response echoes, so what the client
      // gets back matches what was written.
      created.twilioCallSid = initiated.sid
    } catch (error) {
      // Compare-and-set on "queued", scoped by orgId, so this can only settle the
      // row just written and only while nothing else has moved it.
      try {
        await prisma.call.updateMany({
          where: { id: created.id, orgId, status: 'queued' },
          data: { status: 'failed' },
        })
      } catch (cleanupError) {
        logger.error(
          { orgId, userId, callId: created.id, error: cleanupError },
          'could not mark an undialed call failed',
        )
      }
      // Rethrow so wrapRoute owns the log, the report, and the 500.
      throw error
    }

    // Identifiers only — never the numbers, which are PII the row id already
    // points to.
    logger.info({ orgId, userId, callId: created.id }, 'placed an outbound call')

    // --- Return response ---
    res.status(201).json({ call: mapCallToApi(created) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/calls/:id — hang up an active call
// ============================================================
// Ends a call that is still up: tells Twilio to drop the leg, then settles the
// row to "canceled" with an endedAt. Scoped to the org in the path, so a call in
// another org — or one that does not exist — is answered 404 the same way, and
// this route never confirms a row it must not reveal (MAI-29). A call that has
// already ended is 400, not a silent success: there is nothing to hang up.
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/calls/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id
    const id = String(req.params.id)

    // --- Verify ownership ---
    // Before any row is read: a non-member must not hang up this org's calls, and
    // must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // id AND orgId together, never id alone: the tenant key is half the lookup, so
    // a real id in another org matches nothing and falls to the 404 below.
    const call = await prisma.call.findFirst({ where: { id, orgId } })
    if (!call) {
      return void res.status(404).json({ error: 'Call not found' })
    }

    // A call that has already ended cannot be hung up. 400 rather than a no-op
    // success, so the client is not told it stopped a call that was never running.
    if (TERMINAL_STATUSES.includes(call.status)) {
      return void res.status(400).json({ error: ALREADY_ENDED_ERROR })
    }

    // --- Ask Twilio to hang up ---
    // Only when Twilio has a call to hang up. A queued row with no SID yet has no
    // live leg — Twilio never accepted it — so hanging up a SID that does not
    // exist would just error. It is canceled in the database directly instead. The
    // Twilio client is injected (dependencies/twilio.ts), so this path is exercised
    // in tests without a network, an account, or a cent spent.
    if (call.twilioCallSid) {
      await hangUpCall(call.twilioCallSid)
    }

    // --- Settle the row ---
    // updateMany with orgId, never update by id: the tenant key carries the
    // boundary. Scoped to the in-flight statuses so two hang-ups racing cannot both
    // stamp endedAt — the second finds count 0 and the row it already settled.
    const endedAt = new Date()
    const settled = await prisma.call.updateMany({
      where: { id, orgId, status: { in: IN_FLIGHT_STATUSES } },
      data: { status: 'canceled', endedAt },
    })
    if (settled.count === 0) {
      // Another request ended this call between the read above and here. It is no
      // longer hang-up-able, so report it the same way the terminal check does.
      return void res.status(400).json({ error: ALREADY_ENDED_ERROR })
    }

    logger.info({ orgId, userId, callId: id }, 'hung up a call')

    // --- Return response ---
    // Re-read so the response carries the stored row, not a hand-patched copy.
    // recordingUrl is a bare object key, signed at request time as in the detail
    // route; a call hung up mid-flight has no recording, so this is virtually
    // always null.
    const updated = await prisma.call.findFirst({ where: { id, orgId } })
    if (!updated) {
      return void res.status(404).json({ error: 'Call not found' })
    }
    const recordingUrl = updated.recordingUrl
      ? await getRecordingDownloadUrl(updated.recordingUrl)
      : null
    res.json({ call: mapCallToDetailApi(updated, recordingUrl) })
  }),
)

export default router
