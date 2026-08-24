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
 * This file owns four Twilio endpoints. POST /voice returns TwiML for a call the
 * rep's browser Voice SDK Device originated (`Device.connect({ params: { callId }
 * })`, vite/src/components/dialer/DialerProvider.tsx) — it is TOLD which call by
 * the `callId` param that connect() carries, not by Twilio's `Direction`, because
 * that param can only be present on a request WE built. The same URL is where
 * purchased numbers point their INBOUND calls: a request with no `callId` and
 * `Direction: "inbound"` for a `To` we recognize (handleInboundCall below) rings
 * that number's assigned browser Device, then sends an unanswered browser leg to
 * the org's personal voicemail greeting — or a default, if it has none — and
 * records the caller with `<Record>`. An unassigned recognized number goes
 * straight to that voicemail flow. Anything else with no `callId` (a stray
 * request, an unrecognized `To`) hears an honest "not accepting calls" message
 * instead. POST /voice tells Twilio to record the bridged call only when the
 * row's server-resolved `recordingPlanned` decision is true. POST /voice/status is the call-progress
 * status callback: it maps Twilio's CallStatus onto Call.status and records
 * duration and end time. POST /voice/recording-status is the recording-progress
 * callback — the only place Twilio delivers a `RecordingSid` for a `<Dial
 * record>` call — and is where `recordingEnabled` is set from Twilio's own
 * confirmation and the upload/transcribe pipeline is kicked off. POST
 * /voice/voicemail-recording is its inbound-voicemail twin: the only place Twilio
 * delivers a `RecordingSid` for an inbound `<Record>`, and where the voicemail
 * upload pipeline is kicked off.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import {
  buildBridgeTwiml,
  buildEmptyTwiml,
  buildInboundDeliveryTwiml,
  buildInboundMobileRejectTwiml,
  buildInboundMobileTwiml,
  buildInboundMobileWhisperTwiml,
  buildInboundUnavailableTwiml,
  buildVoicemailTwiml,
  verifyTwilioSignature,
} from '../../dependencies/twilio.js'
import { getRecordingDownloadUrl } from '../../dependencies/s3.js'
import { PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { queueUploadRecording } from '../jobs/uploadRecording.js'
import { queueUploadVoicemail } from '../jobs/uploadVoicemail.js'
import { queueCallWebPush } from '../jobs/callWebPush.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { matchInboundCallerToCrm } from '../lib/callMatch.js'
import { automaticDispositionValue, TERMINAL_CALL_STATUSES, TWILIO_TO_CALL_STATUS } from '../lib/callStatus.js'

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

/**
 * Handle a request to POST /voice that carries no `callId` — a real inbound call
 * to a purchased number, or anything else that isn't one of our browser-originated
 * calls.
 *
 * A genuine inbound call (`Direction === 'inbound'`, and `To` matching an active
 * `PhoneNumber` row we know about) rings its assigned browser Device. If the
 * number is unassigned, or that browser leg does not complete, the caller enters
 * the voicemail flow. Anything else — a stray request, an unrecognized `To` —
 * gets the same honest "not accepting calls" TwiML the outbound handler already
 * returned here, and touches no row.
 */
async function handleInboundCall(
  req: Request,
  res: Response,
  params: Record<string, string>,
): Promise<void> {
  const callSid = params.CallSid
  const fromE164 = params.From
  const toE164 = params.To

  const phoneNumber =
    params.Direction === 'inbound' && toE164
      ? await prisma.phoneNumber.findFirst({ where: { e164: toE164, status: 'active' } })
      : null

  if (!phoneNumber || !callSid) {
    logger.info(
      {
        route: 'POST /api/twilio/voice',
        requestId: req.id,
        direction: params.Direction,
        toE164: toE164 ? `***${toE164.slice(-4)}` : undefined,
      },
      'twilio voice webhook: not a recognized inbound call; returning unavailable TwiML',
    )
    res.status(200).type('text/xml').send(buildInboundUnavailableTwiml())
    return
  }

  // --- Ring the assigned browser Device ---
  // The CallSid for the inbound PSTN leg is already known, making it the
  // idempotency key for Twilio's at-least-once webhook delivery. A held but
  // unassigned number remains voicemail-only until an admin assigns it.
  if (phoneNumber.assignedUserId) {
    // The called number owns the tenant boundary. A caller number can belong to
    // more than one contact, so the matcher deliberately returns null links
    // unless exactly one phone in THIS organization owns its normalized E.164.
    const crmLinks = await matchInboundCallerToCrm(prisma, phoneNumber.orgId, fromE164 ?? '')
    const call = await prisma.call.upsert({
      where: { twilioCallSid: callSid },
      create: {
        orgId: phoneNumber.orgId,
        userId: phoneNumber.assignedUserId,
        fromE164: fromE164?.trim() ?? '',
        toE164,
        direction: 'inbound',
        status: 'ringing',
        twilioCallSid: callSid,
        startedAt: new Date(),
        ...crmLinks,
      },
      update: {},
    })

    const forwarding = await prisma.inboundForwarding.findFirst({
      where: { orgId: phoneNumber.orgId, userId: phoneNumber.assignedUserId, enabled: true },
    })
    const mobileE164 = forwarding?.mobileE164

    logger.info(
      { route: 'POST /api/twilio/voice', requestId: req.id, orgId: call.orgId, callId: call.id },
      'inbound call ringing assigned browser Device',
    )
    void queueCallWebPush({ userId: call.userId, event: 'incoming', eventKey: `call:${call.id}:incoming` }).catch((error) => {
      logger.error({ orgId: call.orgId, callId: call.id, error }, 'could not queue incoming call web push')
    })

    res.status(200).type('text/xml').send(
      buildInboundDeliveryTwiml({
        identity: call.userId,
        callId: call.id,
        ...(mobileE164
          ? {
              forwarding: {
                mobileE164,
                strategy: forwarding.strategy === 'simultaneous' ? 'simultaneous' : 'browser_fallback',
                callerId: phoneNumber.e164,
              },
            }
          : {}),
      }),
    )
    return
  }

  await respondWithInboundVoicemail(req, res, {
    callSid,
    fromE164: fromE164 ?? '',
    orgId: phoneNumber.orgId,
    toE164,
  })
}

/** Continue an inbound caller into the existing greeting-and-record flow. */
async function respondWithInboundVoicemail(
  req: Request,
  res: Response,
  inbound: { callSid: string; fromE164: string; orgId: string; toE164: string },
): Promise<void> {
  // --- Fetch the org's personal greeting, or fall back to the default ---
  // A presigned GET URL, not the bare S3 key: Twilio's <Play> fetches it directly
  // over HTTPS, exactly as a browser would a recording download link.
  const greeting = await prisma.voicemailGreeting.findFirst({
    where: { orgId: inbound.orgId, status: 'active' },
  })
  const greetingAudioUrl = greeting?.storageKey ? await getRecordingDownloadUrl(greeting.storageKey) : null

  // --- Create the Voicemail row ---
  // Upserted on callSid (unique): Twilio's webhook delivery is at-least-once, so a
  // retried request must not fail on a duplicate-key error. `greeting` records the
  // bare S3 key the caller actually heard, not a relation, since the org's
  // greeting can be replaced later (see schema.prisma).
  await prisma.voicemail.upsert({
    where: { callSid: inbound.callSid },
    create: {
      orgId: inbound.orgId,
      callSid: inbound.callSid,
      fromE164: inbound.fromE164,
      toE164: inbound.toE164,
      greeting: greeting?.storageKey ?? null,
    },
    update: {},
  })

  const assigned = await prisma.phoneNumber.findFirst({ where: { e164: inbound.toE164, status: 'active' }, select: { assignedUserId: true } })
  if (assigned?.assignedUserId) {
    void queueCallWebPush({ userId: assigned.assignedUserId, event: 'voicemail', eventKey: `voicemail:${inbound.callSid}` }).catch((error) => {
      logger.error({ orgId: inbound.orgId, callSid: inbound.callSid, error }, 'could not queue voicemail web push')
    })
  }

  logger.info(
    { route: 'POST /api/twilio/voice', requestId: req.id, orgId: inbound.orgId, callSid: inbound.callSid },
    'inbound call answered; playing greeting and recording voicemail',
  )

  res.status(200).type('text/xml').send(buildVoicemailTwiml({ greetingAudioUrl }))
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
    // our browser-originated calls. A real inbound call to a purchased number is
    // exactly this case, and is handled below.
    if (!callId) {
      return void (await handleInboundCall(req, res, params))
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
    const advanced = await prisma.call.updateMany({
      where: { id: call.id, orgId: call.orgId, status: 'queued' },
      data: { status: 'ringing', startedAt: new Date(), twilioCallSid: callSid },
    })
    if (advanced.count > 0) {
      logger.info(
        {
          event: 'dialer_call_state_changed',
          route: 'POST /api/twilio/voice',
          requestId: req.id,
          orgId: call.orgId,
          userId: call.userId,
          callId: call.id,
          oldStatus: 'queued',
          newStatus: 'ringing',
        },
        'dialer call state changed',
      )
    }

    // --- Return TwiML ---
    // Bridges the browser leg already on the line to the ONE destination number —
    // text/xml is what Twilio expects; the SDK escapes and well-forms the XML.
    // `record` is derived from the row's own stored consent, never from anything
    // Twilio sends: a request Twilio never verified cannot turn recording on.
    res.status(200).type('text/xml').send(
      buildBridgeTwiml({
        toE164: call.toE164,
        callerId: call.fromE164,
        record: call.recordingPlanned === true,
      }),
    )
  }),
)

// ============================================================
// POST /api/twilio/voice/inbound-result — browser leg terminal result
// ============================================================
// `<Dial action>` delivers the outcome of the assigned browser Device attempt.
// A completed browser call ends cleanly; every other outcome continues the
// original PSTN caller into the existing voicemail flow, so there is no silence.
router.post(
  '/voice/inbound-result',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/inbound-result'),
  wrapRoute('POST /api/twilio/voice/inbound-result', async (req, res) => {
    // --- Parse & validate params ---
    const params = (req.body ?? {}) as Record<string, string>
    const callId = typeof req.query.callId === 'string' ? req.query.callId : undefined
    const leg = typeof req.query.leg === 'string' ? req.query.leg : 'browser'
    const parentCallSid = params.CallSid
    const dialStatus = params.DialCallStatus

    // --- Find the inbound call ---
    // Both callId (server-issued inside the Client parameter and action URL) and
    // the parent CallSid (Twilio-signed) must match. This keeps a valid callback
    // for one inbound call from ever advancing another organization's row.
    const call = callId && parentCallSid
      ? await prisma.call.findFirst({
          where: { id: callId, direction: 'inbound', twilioCallSid: parentCallSid },
        })
      : null
    if (!call) {
      logger.warn(
        { route: 'POST /api/twilio/voice/inbound-result', requestId: req.id, callId },
        'inbound browser result for an unknown call',
      )
      return void res.status(200).type('text/xml').send(buildInboundUnavailableTwiml())
    }

    // --- Persist the terminal browser-leg result ---
    const mappedStatus = dialStatus ? TWILIO_TO_CALL_STATUS[dialStatus] : undefined
    const status = mappedStatus ?? 'failed'
    const durationS = Number.parseInt(params.DialCallDuration ?? '', 10)
    const forwarding = status !== 'completed' && leg === 'browser'
      ? await prisma.inboundForwarding.findFirst({
          where: {
            orgId: call.orgId,
            userId: call.userId,
            enabled: true,
            strategy: 'browser_fallback',
            mobileE164: { not: null },
          },
        })
      : null
    const mobileE164 = forwarding?.mobileE164
    const continuesToMobile = !!mobileE164
    const nextStatus = continuesToMobile ? 'ringing' : status
    const updated = await prisma.call.updateMany({
      where: { id: call.id, orgId: call.orgId },
      data: {
        status: nextStatus,
        ...(continuesToMobile ? {} : { endedAt: new Date() }),
        ...(Number.isFinite(durationS) ? { durationS } : {}),
      },
    })
    if (updated.count > 0 && nextStatus !== call.status) {
      logger.info(
        {
          event: 'dialer_call_state_changed',
          route: 'POST /api/twilio/voice/inbound-result',
          requestId: req.id,
          orgId: call.orgId,
          userId: call.userId,
          callId: call.id,
          oldStatus: call.status,
          newStatus: nextStatus,
        },
        'dialer call state changed',
      )
    }
    if (status !== 'completed') {
      void queueCallWebPush({ userId: call.userId, event: 'missed', eventKey: `call:${call.id}:missed` }).catch((error) => {
        logger.error({ orgId: call.orgId, callId: call.id, error }, 'could not queue missed call web push')
      })
    }

    // --- Return the next TwiML ---
    if (status === 'completed') {
      return void res.status(200).type('text/xml').send(buildEmptyTwiml())
    }

    if (mobileE164) {
      return void res.status(200).type('text/xml').send(
        buildInboundMobileTwiml({
          callId: call.id,
          mobileE164,
          callerId: call.toE164,
        }),
      )
    }

    await respondWithInboundVoicemail(req, res, {
      callSid: call.twilioCallSid!,
      fromE164: call.fromE164,
      orgId: call.orgId,
      toE164: call.toE164,
    })
  }),
)

// ============================================================
// POST /api/twilio/voice/mobile-whisper — private mobile-leg acceptance prompt
// ============================================================
router.post(
  '/voice/mobile-whisper',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/mobile-whisper'),
  wrapRoute('POST /api/twilio/voice/mobile-whisper', async (req, res) => {
    const callId = typeof req.query.callId === 'string' ? req.query.callId : undefined
    const call = callId
      ? await prisma.call.findFirst({ where: { id: callId, direction: 'inbound' } })
      : null
    if (!call) return void res.status(200).type('text/xml').send(buildInboundMobileRejectTwiml())

    return void res.status(200).type('text/xml').send(
      buildInboundMobileWhisperTwiml({ callerE164: call.fromE164, callId: call.id }),
    )
  }),
)

// ============================================================
// POST /api/twilio/voice/mobile-accept — evaluate the private whisper keypress
// ============================================================
router.post(
  '/voice/mobile-accept',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/mobile-accept'),
  wrapRoute('POST /api/twilio/voice/mobile-accept', async (req, res) => {
    const callId = typeof req.query.callId === 'string' ? req.query.callId : undefined
    const call = callId
      ? await prisma.call.findFirst({ where: { id: callId, direction: 'inbound' } })
      : null
    const digits = (req.body as Record<string, string> | undefined)?.Digits

    return void res.status(200).type('text/xml').send(
      call && digits === '1' ? buildEmptyTwiml() : buildInboundMobileRejectTwiml(),
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
    const answeredBy = params.AnsweredBy
    const recordingSid = params.RecordingSid
    const mappedStatus = callStatus ? TWILIO_TO_CALL_STATUS[callStatus] : undefined

    // --- Find the call ---
    // A browser Device callback names its child leg in CallSid and its inbound
    // PSTN parent in ParentCallSid. Prefer the parent so it reaches the inbound
    // Call row; otherwise the unique CallSid is the lifecycle key. Neither is a
    // caller-controlled application id.
    const parentCallSid = params.ParentCallSid
    const call = await prisma.call.findFirst({
      where: parentCallSid
        ? { OR: [{ twilioCallSid: callSid }, { twilioCallSid: parentCallSid }] }
        : { twilioCallSid: callSid },
    })
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
    const updated = Object.keys(data).length > 0
      ? await prisma.call.updateMany({ where: { id: call.id, orgId: call.orgId }, data })
      : null

    if (updated && updated.count > 0 && mappedStatus && mappedStatus !== call.status) {
      logger.info(
        {
          event: 'dialer_call_state_changed',
          route: 'POST /api/twilio/voice/status',
          requestId: req.id,
          orgId: call.orgId,
          userId: call.userId,
          callId: call.id,
          oldStatus: call.status,
          newStatus: mappedStatus,
        },
        'dialer call state changed',
      )
    }

    // --- Apply a deterministic dead-call disposition ---
    // This is intentionally a separate, compare-and-set write. The lifecycle
    // update above must still accept Twilio retries after a disposition exists,
    // while this write can only win if a rep has not already selected an outcome.
    // A missing or archived configuration is an honest no-op: automation never
    // invents a fallback business outcome.
    const dispositionValue = call.dispositionId
      ? null
      : automaticDispositionValue(mappedStatus, answeredBy)
    if (dispositionValue) {
      const disposition = await prisma.dispositionDef.findFirst({
        where: { orgId: call.orgId, value: dispositionValue, isArchived: false },
        select: { id: true },
      })
      if (disposition) {
        await prisma.call.updateMany({
          where: { id: call.id, orgId: call.orgId, dispositionId: null },
          data: { dispositionId: disposition.id },
        })
      }
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
// recordingPlanned was true at the moment POST /voice ran. This is the ONLY
// place Twilio delivers a RecordingSid for this architecture — it is not part of
// the CallStatus callback above, because the recording belongs to the <Dial>
// verb, not the <Number> leg that callback tracks. `recordingEnabled` is set HERE,
// from Twilio's own confirmation that a recording exists — never from policy —
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

// ============================================================
// POST /api/twilio/voice/voicemail-recording — inbound voicemail recording-progress callback
// ============================================================
// Twilio POSTs here once an inbound voicemail `<Record>` finishes (wired in as
// `recordingStatusCallback`, buildVoicemailTwiml, scoped to `completed` only — an
// `in-progress` delivery has no media yet). This is where the Voicemail row
// actually gets a recording: the upload job fetches the MP3 from Twilio and
// stores it in S3, the outbound twin of POST /voice/recording-status.
router.post(
  '/voice/voicemail-recording',
  express.urlencoded({ extended: false }),
  verifyTwilioWebhook('POST /api/twilio/voice/voicemail-recording'),
  wrapRoute('POST /api/twilio/voice/voicemail-recording', async (req, res) => {
    // --- Parse & validate params ---
    const params = (req.body ?? {}) as Record<string, string>
    const callSid = params.CallSid
    const recordingSid = params.RecordingSid

    // --- Find the voicemail ---
    // By callSid alone: it is the unique key stamped on the row when the inbound
    // call was first answered (POST /voice above), and it is the only key Twilio
    // hands this callback.
    const voicemail = await prisma.voicemail.findFirst({ where: { callSid } })
    if (!voicemail) {
      logger.warn(
        { route: 'POST /api/twilio/voice/voicemail-recording', requestId: req.id, callSid },
        'twilio voicemail-recording callback for an unknown CallSid',
      )
      return void res.status(404).json({ error: 'Voicemail not found' })
    }

    // --- Chain the upload pipeline ---
    if (recordingSid) {
      await queueUploadVoicemail(voicemail.id, recordingSid)
      logger.info(
        {
          route: 'POST /api/twilio/voice/voicemail-recording',
          requestId: req.id,
          orgId: voicemail.orgId,
          voicemailId: voicemail.id,
        },
        'voicemail recording complete, queued upload',
      )
    }

    // --- Return response ---
    // Twilio ignores the body; a keyed 200 acknowledges receipt.
    res.status(200).json({ received: true })
  }),
)

export default router
