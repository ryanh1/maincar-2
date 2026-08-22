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
 * This file owns three Twilio endpoints. POST /voice returns TwiML for a call the
 * rep's browser Voice SDK Device originated (`Device.connect({ params: { callId }
 * })`, vite/src/components/dialer/DialerProvider.tsx) — it is TOLD which call by
 * the `callId` param that connect() carries, not by Twilio's `Direction`, because
 * that param can only be present on a request WE built. The same URL is where
 * purchased numbers point their INBOUND calls (a later phase), so a request with
 * no `callId` — including every real inbound call — hears an honest unavailable
 * message rather than silence. It tells Twilio to record the bridged call only
 * when the row's `recordingConsent` is `"granted"`. POST /voice/status is the
 * call-progress status callback: it maps Twilio's CallStatus onto Call.status and
 * records duration and end time. POST /voice/recording-status is the
 * recording-progress callback — the only place Twilio delivers a `RecordingSid`
 * for a `<Dial record>` call — and is where `recordingEnabled` is set from
 * Twilio's own confirmation and the upload/transcribe pipeline is kicked off.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import { buildBridgeTwiml, buildInboundUnavailableTwiml, verifyTwilioSignature } from '../../dependencies/twilio.js'
import { PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { queueUploadRecording } from '../jobs/uploadRecording.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { TERMINAL_CALL_STATUSES, TWILIO_TO_CALL_STATUS } from '../lib/callStatus.js'

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
 *
 * A factory rather than a bare middleware so each route logs its own name on a
 * rejection — the voice webhook and the status callback share this check but are
 * different endpoints, and a warning that names the wrong one is a debugging trap.
 */
function verifyTwilioWebhook(routeLabel: string) {
  return function verify(req: Request, res: Response, next: NextFunction): void {
    const signature = req.header('X-Twilio-Signature') ?? undefined
    const url = `${PUBLIC_BASE_URL}${req.originalUrl}`
    const params = (req.body ?? {}) as Record<string, string>

    if (!verifyTwilioSignature({ signature, url, params })) {
      logger.warn(
        { route: routeLabel, requestId: req.id },
        'rejected a Twilio webhook: invalid signature',
      )
      res.status(403).json({ error: 'Invalid Twilio signature' })
      return
    }
    next()
  }
}

// ============================================================
// POST /api/twilio/voice — TwiML for a call the rep's browser Device placed
// ============================================================
// Twilio fetches this the instant the rep's Voice SDK Device connects. The reply
// is TwiML bridging that browser leg to the destination; as a side effect the
// Call row is stamped with the CallSid Twilio just assigned and advanced from
// "queued" to "ringing".
router.post(
  '/voice',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice'),
  wrapRoute('POST /api/twilio/voice', async (req, res) => {
    const params = (req.body ?? {}) as Record<string, string>
    const callId = params.callId
    const callSid = params.CallSid

    // --- Recognize a call WE originated ---
    // callId is a custom param `Device.connect({ params: { callId } })` sends —
    // nothing else can produce it, so its absence means this request is not one of
    // our browser-originated calls (a real inbound call to a purchased number,
    // most likely — a later phase). Tell the caller the number is unavailable
    // instead of dropping them into silence. No row is touched: the future inbound
    // and voicemail flow owns persistence.
    if (!callId) {
      logger.info(
        { route: 'POST /api/twilio/voice', requestId: req.id },
        'twilio voice webhook with no callId; returning inbound unavailable TwiML',
      )
      return void res.status(200).type('text/xml').send(buildInboundUnavailableTwiml())
    }

    // --- Find the queued call ---
    // By id alone: it is the only key the browser's connect() carried, and it is
    // unguessable without also forging Twilio's signature (verified above).
    const call = await prisma.call.findFirst({ where: { id: callId } })
    if (!call) {
      logger.warn(
        { route: 'POST /api/twilio/voice', requestId: req.id, callId },
        'twilio voice webhook for an unknown callId',
      )
      return void res.status(404).json({ error: 'Call not found' })
    }

    // --- Advance the row to ringing, and stamp the SID ---
    // Compare-and-set on "queued": this is the FIRST place a SID for this call
    // exists (nothing called Twilio's REST API to create it), so this write only
    // ever fires once. Twilio does not retry a URL it already got a 200 from, but
    // the guard keeps a re-fetch from re-stamping a SID or re-timing startedAt.
    // updateMany scoped by orgId, never update-by-id: the tenant key carries the
    // boundary (rules/database-and-prisma.md).
    await prisma.call.updateMany({
      where: { id: call.id, orgId: call.orgId, status: 'queued' },
      data: { status: 'ringing', startedAt: new Date(), twilioCallSid: callSid },
    })

    logger.info(
      { route: 'POST /api/twilio/voice', requestId: req.id, orgId: call.orgId, callId: call.id },
      'browser call ringing; returning bridge TwiML',
    )

    // --- Return TwiML ---
    // Bridges the browser leg already on the line to the ONE destination number —
    // text/xml is what Twilio expects; the SDK escapes and well-forms the XML.
    // `record` is derived from the row's own stored consent, never from anything
    // Twilio sends: a request Twilio never verified cannot turn recording on.
    res.status(200).type('text/xml').send(
      buildBridgeTwiml({
        toE164: call.toE164,
        callerId: call.fromE164,
        record: call.recordingConsent === 'granted',
      }),
    )
  }),
)

// ============================================================
// POST /api/twilio/voice/status — call-progress status callback
// ============================================================
// Twilio POSTs here as a call moves through its lifecycle (initiated → ringing →
// answered → completed), the URL the bridged leg's <Number> carries as its own
// statusCallback (dependencies/twilio.ts → buildBridgeTwiml,
// OUTBOUND_STATUS_WEBHOOK_PATH). Each event carries the
// CallSid we look the row up by, the CallStatus we map onto Call.status, and — on
// completion — CallDuration and, when the call was recorded, a RecordingSid. The
// reply body is ignored by Twilio; a 200 just acknowledges receipt.
router.post(
  '/voice/status',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/status'),
  wrapRoute('POST /api/twilio/voice/status', async (req, res) => {
    // --- Parse & validate params ---
    const params = (req.body ?? {}) as Record<string, string>
    const callSid = params.CallSid
    const callStatus = params.CallStatus
    const recordingSid = params.RecordingSid
    const mappedStatus = callStatus ? TWILIO_TO_CALL_STATUS[callStatus] : undefined

    // --- Find the call ---
    // By twilioCallSid alone, exactly as the voice webhook does: it is unique and
    // is the only key Twilio hands us. An unknown SID is a 404 — Twilio is asking
    // about a call we have no row for.
    const call = await prisma.call.findFirst({ where: { twilioCallSid: callSid } })
    if (!call) {
      logger.warn(
        { route: 'POST /api/twilio/voice/status', requestId: req.id, callSid },
        'twilio status callback for an unknown CallSid',
      )
      return void res.status(404).json({ error: 'Call not found' })
    }

    // --- Build the update ---
    // Only fields Twilio actually reported are written. A CallStatus outside the
    // whitelist leaves `status` untouched (and is logged), a terminal status
    // stamps endedAt, and CallDuration — whole seconds, sent as a string only once
    // the call is billed — becomes durationS when it parses to a finite number.
    const data: {
      status?: string
      endedAt?: Date
      durationS?: number
    } = {}

    if (mappedStatus) {
      data.status = mappedStatus
      if (TERMINAL_CALL_STATUSES.has(mappedStatus)) data.endedAt = new Date()
    } else if (callStatus) {
      logger.warn(
        { route: 'POST /api/twilio/voice/status', requestId: req.id, callSid, callStatus },
        'twilio status callback with an unrecognized CallStatus; leaving status unchanged',
      )
    }

    const durationS = Number.parseInt(params.CallDuration ?? '', 10)
    if (Number.isFinite(durationS)) data.durationS = durationS

    // --- Execute the write ---
    // updateMany scoped by orgId, never update-by-id: the tenant key carries the
    // boundary (rules/database-and-prisma.md). Skipped when there is nothing to
    // write, so a bare ping does not churn updatedAt.
    if (Object.keys(data).length > 0) {
      await prisma.call.updateMany({ where: { id: call.id, orgId: call.orgId }, data })
    }

    // --- Chain the recording pipeline ---
    // A RecordingSid on the callback is the signal a recording exists. Enqueue the
    // upload job (which fetches it from Twilio and stores it in S3); that job, on a
    // successful store, chains the transcription. Both jobs are idempotent, so a
    // status callback Twilio delivers more than once cannot double-store or
    // double-transcribe. The SID is not persisted on the row — it rides on the job
    // payload, which is the only place it exists (jobs/uploadRecording.ts).
    if (recordingSid) {
      await queueUploadRecording(call.id, recordingSid)
      logger.info(
        { route: 'POST /api/twilio/voice/status', requestId: req.id, orgId: call.orgId, callId: call.id },
        'twilio status callback: recording present, queued upload',
      )
    }

    logger.info(
      {
        route: 'POST /api/twilio/voice/status',
        requestId: req.id,
        orgId: call.orgId,
        callId: call.id,
        status: data.status,
      },
      'twilio status callback processed',
    )

    // --- Return response ---
    // Twilio ignores the body; a keyed 200 acknowledges receipt.
    res.status(200).json({ received: true })
  }),
)

// ============================================================
// POST /api/twilio/voice/recording-status — recording-progress callback
// ============================================================
// Twilio POSTs here only for a call whose <Dial> carried `record`
// (dependencies/twilio.ts -> buildBridgeTwiml), which happens only when the row's
// recordingConsent was "granted" at the moment POST /voice ran. This is the ONLY
// place Twilio delivers a RecordingSid for this architecture — it is not part of
// the CallStatus callback above, because the recording belongs to the <Dial>
// verb, not the <Number> leg that callback tracks. `recordingEnabled` is set HERE,
// from Twilio's own confirmation that a recording exists — never from consent —
// so a call whose recording failed to start still reads as not recorded.
const RECORDING_STATUSES_MEANING_RECORDING_HAPPENED = new Set(['in-progress', 'completed'])

router.post(
  '/voice/recording-status',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/recording-status'),
  wrapRoute('POST /api/twilio/voice/recording-status', async (req, res) => {
    // --- Parse & validate params ---
    const params = (req.body ?? {}) as Record<string, string>
    const callSid = params.CallSid
    const recordingSid = params.RecordingSid
    const recordingStatus = params.RecordingStatus

    // --- Find the call ---
    // By twilioCallSid alone, exactly as the status callback does: it is the SID
    // of the browser leg that <Dial> hung off, which is the same SID stamped by
    // POST /voice above.
    const call = await prisma.call.findFirst({ where: { twilioCallSid: callSid } })
    if (!call) {
      logger.warn(
        { route: 'POST /api/twilio/voice/recording-status', requestId: req.id, callSid },
        'twilio recording-status callback for an unknown CallSid',
      )
      return void res.status(404).json({ error: 'Call not found' })
    }

    // --- Mark recording as confirmed ---
    // "in-progress" and "completed" both mean Twilio is actually recording; either
    // is enough to flip the flag on. Anything else (failed, absent) is logged and
    // left alone — recordingEnabled stays whatever it already was rather than
    // being guessed at. updateMany scoped by orgId, never update-by-id
    // (rules/database-and-prisma.md).
    if (RECORDING_STATUSES_MEANING_RECORDING_HAPPENED.has(recordingStatus)) {
      await prisma.call.updateMany({
        where: { id: call.id, orgId: call.orgId },
        data: { recordingEnabled: true },
      })
    } else {
      logger.warn(
        {
          route: 'POST /api/twilio/voice/recording-status',
          requestId: req.id,
          orgId: call.orgId,
          callId: call.id,
          recordingStatus,
        },
        'twilio recording-status callback reported the recording did not happen',
      )
    }

    // --- Chain the upload pipeline ---
    // Only once the recording is actually done — media exists to fetch only on
    // "completed"; an "in-progress" delivery has nothing to download yet.
    if (recordingStatus === 'completed' && recordingSid) {
      await queueUploadRecording(call.id, recordingSid)
      logger.info(
        {
          route: 'POST /api/twilio/voice/recording-status',
          requestId: req.id,
          orgId: call.orgId,
          callId: call.id,
        },
        'twilio recording-status callback: recording complete, queued upload',
      )
    }

    // --- Return response ---
    // Twilio ignores the body; a keyed 200 acknowledges receipt.
    res.status(200).json({ received: true })
  }),
)

export default router
