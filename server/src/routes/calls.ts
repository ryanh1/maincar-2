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
import { initiateOutboundCall } from '../../dependencies/twilio.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
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

// The call states that mean "a call is already up". A second call to the same
// number while one of these is in flight is the double-click this route guards
// against. Terminal states (completed, busy, failed, no-answer, canceled) are
// absent on purpose: once a call has ended, dialing the number again is a new,
// wanted call.
const IN_FLIGHT_STATUSES = ['queued', 'ringing', 'in-progress']

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

        // orgId comes from the path and userId from the verified caller — neither
        // is read off the body. status is written out rather than left to the
        // schema default because this response promises it.
        return tx.call.create({
          data: {
            orgId,
            userId,
            fromE164,
            toE164,
            direction: 'outbound',
            status: 'queued',
            recordingConsent,
          },
        })
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

export default router
