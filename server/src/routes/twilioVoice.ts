/**
 * Twilio voice webhook: the URL Twilio fetches for TwiML once it has one of our
 * calls in hand.
 *
 * Unlike every other router, this one is NOT behind `requireAuth` and NOT
 * org-scoped by a path segment — the caller is Twilio, not a signed-in user, so
 * there is no ID token and no `:orgId`. It is authenticated instead by the
 * `X-Twilio-Signature` header (see `verifyTwilioWebhook` below), which only a
 * request Twilio actually signed with our auth token can produce.
 *
 * Twilio POSTs `application/x-www-form-urlencoded`, so this router parses
 * urlencoded bodies itself — the app is otherwise JSON-only. The parser is
 * scoped to the route rather than added globally, so nothing else starts
 * accepting form posts.
 *
 * Today this file owns only the OUTBOUND leg (`Direction === "outbound-api"`),
 * which the composer's POST /calls set in motion. The same URL is where
 * purchased numbers point their INBOUND calls, and the status callback
 * (/api/twilio/voice/status) lands beside this route — both are later issues, so
 * a Direction this handler does not dial is answered with empty TwiML rather than
 * mis-dialed.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import { buildDialTwiml, buildEmptyTwiml, verifyTwilioSignature } from '../../dependencies/twilio.js'
import { PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'

const router = Router()

/**
 * Reject anything that is not a genuine, signed Twilio request BEFORE the handler
 * runs (rules/server-routes.md → "All external webhooks verify signatures in
 * middleware before the handler").
 *
 * Twilio signs over the exact URL it fetched, which is the one built from
 * PUBLIC_BASE_URL — the public origin Twilio reached us on — not `req.host`,
 * which behind the tunnel is an internal name that would never match. The query
 * string is part of what Twilio signed, so `req.originalUrl` (path AND query) is
 * used, not `req.path`.
 *
 * Runs after the urlencoded parser, so `req.body` holds the POST params the
 * signature is computed over.
 */
function verifyTwilioWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.header('X-Twilio-Signature') ?? undefined
  const url = `${PUBLIC_BASE_URL}${req.originalUrl}`
  const params = (req.body ?? {}) as Record<string, string>

  if (!verifyTwilioSignature({ signature, url, params })) {
    logger.warn(
      { route: 'POST /api/twilio/voice', requestId: req.id },
      'rejected a Twilio voice webhook: invalid signature',
    )
    res.status(403).json({ error: 'Invalid Twilio signature' })
    return
  }
  next()
}

// ============================================================
// POST /api/twilio/voice — TwiML for a call Twilio is placing
// ============================================================
// Twilio fetches this the moment it starts working one of our outbound calls.
// The reply is TwiML telling it whom to dial; as a side effect the Call row is
// advanced from "queued" to "ringing" and stamped with when it started.
router.post(
  '/voice',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook,
  wrapRoute('POST /api/twilio/voice', async (req, res) => {
    const params = (req.body ?? {}) as Record<string, string>
    const direction = params.Direction
    const callSid = params.CallSid

    // --- Outbound only ---
    // This handler dials the destination of an outbound call. An inbound call
    // (a purchased number ringing) reaches the same URL but is a later issue, so
    // any Direction other than outbound-api gets valid, do-nothing TwiML rather
    // than being mis-dialed or 500'd. No row is touched.
    if (direction !== 'outbound-api') {
      logger.info(
        { route: 'POST /api/twilio/voice', requestId: req.id, direction },
        'twilio voice webhook for a non-outbound direction; returning empty TwiML',
      )
      return void res.status(200).type('text/xml').send(buildEmptyTwiml())
    }

    // --- Find the queued call ---
    // By twilioCallSid alone: it is unique (server/prisma/schema.prisma → Call),
    // and it is the only key Twilio hands us here. The POST /calls route stored
    // it the moment Twilio accepted the call, before Twilio fetched this URL.
    const call = await prisma.call.findFirst({ where: { twilioCallSid: callSid } })
    if (!call) {
      logger.warn(
        { route: 'POST /api/twilio/voice', requestId: req.id, callSid },
        'twilio voice webhook for an unknown CallSid',
      )
      return void res.status(404).json({ error: 'Call not found' })
    }

    // --- Advance the row to ringing ---
    // updateMany scoped by orgId, never update-by-id: the tenant key carries the
    // boundary (rules/database-and-prisma.md). startedAt is stamped now — this
    // webhook firing is the moment the call actually began to ring.
    await prisma.call.updateMany({
      where: { id: call.id, orgId: call.orgId },
      data: { status: 'ringing', startedAt: new Date() },
    })

    logger.info(
      { route: 'POST /api/twilio/voice', requestId: req.id, orgId: call.orgId, callId: call.id },
      'outbound call ringing; returning dial TwiML',
    )

    // --- Return TwiML ---
    // text/xml is what Twilio expects; the SDK escapes and well-forms the XML.
    res.status(200).type('text/xml').send(buildDialTwiml(call.toE164))
  }),
)

export default router
