// Route tests for POST /api/twilio/voice — the Twilio voice webhook.
//
// This route is not authenticated by an ID token; it is authenticated by the
// Twilio request signature. So the tests here are shaped differently from the
// org-scoped routes: they prove the 403 on a bad signature, that a genuine
// browser-originated request (one carrying our own `callId` param) looks its Call
// up by id and returns bridge TwiML while stamping the SID and advancing the row
// to ringing, that an unknown callId is a 404, and that a request with no callId
// (a real inbound call, or anything else) gets empty TwiML and touches no row.
//
// verifyTwilioSignature is mocked (so no real signature has to be minted), but
// buildBridgeTwiml/buildEmptyTwiml are kept REAL via importActual, so the
// assertions run against the actual TwiML the SDK produces.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const {
  prismaMock,
  verifySignatureMock,
  queueUploadRecordingMock,
  queueUploadVoicemailMock,
  getRecordingDownloadUrlMock,
} = vi.hoisted(() => ({
  prismaMock: {
    call: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
    },
    phoneNumber: {
      findFirst: vi.fn(),
    },
    voicemailGreeting: {
      findFirst: vi.fn(),
    },
    voicemail: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
  verifySignatureMock: vi.fn(),
  queueUploadRecordingMock: vi.fn(),
  queueUploadVoicemailMock: vi.fn(),
  getRecordingDownloadUrlMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
// The status callback kicks off the recording pipeline through this queue
// function; mock it so the job (and its OpenAI/S3 imports) never load, and so the
// enqueue can be asserted with its exact arguments.
vi.mock('../../jobs/uploadRecording.js', () => ({
  queueUploadRecording: queueUploadRecordingMock,
}))
// Same reasoning, for the inbound voicemail upload job.
vi.mock('../../jobs/uploadVoicemail.js', () => ({
  queueUploadVoicemail: queueUploadVoicemailMock,
}))
// Swap the S3 presigner for a mock: signing a real URL needs real S3/MinIO
// credentials, and the assertion only needs to prove the route asked for one.
vi.mock('../../../dependencies/s3.js', () => ({
  getRecordingDownloadUrl: getRecordingDownloadUrlMock,
}))
// Keep the real TwiML builders (so the response body is genuine TwiML) and swap
// only the signature check for a mock — the one seam that would otherwise need a
// real auth token and a hand-computed HMAC.
vi.mock('../../../dependencies/twilio.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../dependencies/twilio.js')>()
  return { ...actual, verifyTwilioSignature: verifySignatureMock }
})

import app from '../../app.js'

const URL = '/api/twilio/voice'
const SIG = 'fake-twilio-signature'
const CALL_SID = 'CA0123456789abcdef0123456789abcdef'

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    orgId: 'org-a',
    userId: 'user-a',
    fromE164: '+12025550123',
    toE164: '+13035550199',
    direction: 'outbound',
    status: 'queued',
    twilioCallSid: CALL_SID,
    recordingConsent: null,
    recordingPlanned: true,
    recordingReason: 'allowed',
    destinationState: 'CO',
    recordingEnabled: null,
    recordingUrl: null,
    transcriptStatus: 'pending',
    transcript: null,
    durationS: null,
    startedAt: null,
    endedAt: null,
    createdAt: new Date('2026-08-20T12:00:00.000Z'),
    updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    ...overrides,
  }
}

/** POSTs a Twilio-shaped urlencoded webhook with a signature header. */
function post(body: Record<string, string>, signature: string | null = SIG) {
  const req = request(app).post(URL).type('form')
  if (signature !== null) req.set('X-Twilio-Signature', signature)
  return req.send(body)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Genuine Twilio request by default; the bad-signature test overrides this.
  verifySignatureMock.mockReturnValue(true)
  prismaMock.call.findFirst.mockResolvedValue(callRow())
  prismaMock.call.updateMany.mockResolvedValue({ count: 1 })
  queueUploadRecordingMock.mockResolvedValue('upload_job_1')
  // No recognized number and no voicemail by default; the inbound-voicemail
  // tests override these to prove the recognized-number path.
  prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
  prismaMock.voicemailGreeting.findFirst.mockResolvedValue(null)
  prismaMock.voicemail.findFirst.mockResolvedValue(null)
  prismaMock.voicemail.upsert.mockResolvedValue({ id: 'voicemail-1' })
  queueUploadVoicemailMock.mockResolvedValue('voicemail_job_1')
  getRecordingDownloadUrlMock.mockResolvedValue('https://s3.example.com/signed-greeting.mp3')
})

// ============================================================
// Signature — the only thing standing in for auth
// ============================================================
describe('signature verification', () => {
  it('403s when the signature does not verify, before any lookup', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Invalid Twilio signature' })
    // Rejected before it ever touches the database.
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })

  it('403s when the signature header is absent', async () => {
    // A missing header is a false from verifyTwilioSignature; prove the route
    // still refuses rather than skipping the check.
    verifySignatureMock.mockReturnValue(false)

    const res = await post({ CallSid: CALL_SID, callId: 'call-1' }, null)

    expect(res.status).toBe(403)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })

  it('verifies against the signature header and the posted params', async () => {
    await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(verifySignatureMock).toHaveBeenCalledTimes(1)
    const args = verifySignatureMock.mock.calls[0][0]
    expect(args.signature).toBe(SIG)
    expect(args.params).toMatchObject({ CallSid: CALL_SID, callId: 'call-1' })
    expect(args.url).toContain(URL)
  })
})

// ============================================================
// Browser-originated happy path
// ============================================================
describe('a call the browser Device originated (carries our callId)', () => {
  it('returns bridge TwiML dialing the call’s toE164 with its fromE164 as caller ID', async () => {
    const res = await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(res.status).toBe(200)
    expect(res.type).toBe('text/xml')
    expect(res.text).toContain('<Response>')
    expect(res.text).toContain('<Dial callerId="+12025550123"')
    expect(res.text).toContain('<Number')
    expect(res.text).toContain('+13035550199')
  })

  it('tells Twilio to record only when the stored policy decision allows it', async () => {
    prismaMock.call.findFirst.mockResolvedValue(callRow({ recordingPlanned: true }))

    const res = await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(res.text).toContain('record="record-from-answer"')
    expect(res.text).toMatch(/recordingStatusCallback="[^"]*\/api\/twilio\/voice\/recording-status"/)
  })

  it.each([[false], [null]])(
    'never tells Twilio to record when recordingPlanned is %s',
    async (recordingPlanned) => {
      prismaMock.call.findFirst.mockResolvedValue(callRow({ recordingPlanned }))

      const res = await post({ CallSid: CALL_SID, callId: 'call-1' })

      expect(res.text).not.toContain('record=')
      expect(res.text).not.toContain('recordingStatusCallback')
    },
  )

  it.each([
    ['the organization disabled recording', 'recording-disabled'],
    ['the destination needs two-party consent', 'two-party-consent-state'],
    ['the destination state is not allowed', 'state-not-allowed'],
    ['the destination location is unknown', 'unknown-destination-state'],
  ])(
    'does not start a recording for an unavailable policy decision: %s',
    async (_reason, recordingReason) => {
      prismaMock.call.findFirst.mockResolvedValue(
        callRow({ recordingPlanned: false, recordingReason }),
      )

      const res = await post({ CallSid: CALL_SID, callId: 'call-1' })

      expect(res.status).toBe(200)
      expect(res.text).not.toContain('record=')
      expect(res.text).not.toContain('recordingStatusCallback')
    },
  )

  it('looks the call up by id', async () => {
    await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({ where: { id: 'call-1' } })
  })

  it('advances the row to ringing and stamps startedAt and the SID, scoped by orgId and the queued guard', async () => {
    await post({ CallSid: CALL_SID, callId: 'call-1' })

    expect(prismaMock.call.updateMany).toHaveBeenCalledTimes(1)
    const args = prismaMock.call.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'call-1', orgId: 'org-a', status: 'queued' })
    expect(args.data.status).toBe('ringing')
    expect(args.data.startedAt).toBeInstanceOf(Date)
    expect(args.data.twilioCallSid).toBe(CALL_SID)
    // update-by-id is never used for org-scoped data.
    expect(prismaMock.call.update).not.toHaveBeenCalled()
  })

  it('404s when no call matches the callId, and writes nothing', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await post({ CallSid: CALL_SID, callId: 'unknown-call' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Call not found' })
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// No callId — not a call we originated (real inbound, stray request, etc.)
// ============================================================
describe('a request with no callId', () => {
  it('tells an inbound caller that the number is not accepting calls and touches no row', async () => {
    const res = await post({ CallSid: CALL_SID, Direction: 'inbound' })

    expect(res.status).toBe(200)
    expect(res.type).toBe('text/xml')
    expect(res.text).toContain('<Response')
    expect(res.text).toContain('<Say')
    expect(res.text).toContain('This number is not accepting calls. Please try again later.')
    expect(res.text).not.toContain('<Dial')
    // No callId means neither looking up nor advancing a row.
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })

  it('tells the caller the number is unavailable when Direction is inbound but To matches no PhoneNumber', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    const res = await post({ CallSid: CALL_SID, Direction: 'inbound', To: '+15005550006', From: '+12025550123' })

    expect(res.status).toBe(200)
    expect(res.text).toContain('This number is not accepting calls. Please try again later.')
    expect(prismaMock.voicemail.upsert).not.toHaveBeenCalled()
  })
})

// ============================================================
// A real inbound call — Direction is "inbound" and To matches a PhoneNumber
// ============================================================
describe('inbound voicemail', () => {
  function post(body: Record<string, string>, signature: string | null = SIG) {
    const req = request(app).post(URL).type('form')
    if (signature !== null) req.set('X-Twilio-Signature', signature)
    return req.send({ Direction: 'inbound', CallSid: CALL_SID, To: '+13035550199', From: '+12025550123', ...body })
  }

  beforeEach(() => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue({ id: 'pn-1', orgId: 'org-a', e164: '+13035550199' })
  })

  it('answers and records, without the browser-originated bridge TwiML', async () => {
    const res = await post({})

    expect(res.status).toBe(200)
    expect(res.type).toBe('text/xml')
    expect(res.text).toContain('<Response')
    expect(res.text).toContain('<Record')
    expect(res.text).not.toContain('<Dial')
  })

  it('looks the org up by the called number (To)', async () => {
    await post({})

    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith({ where: { e164: '+13035550199' } })
  })

  it('plays the org’s personal greeting when one is uploaded', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue({
      id: 'vg-1',
      orgId: 'org-a',
      storageKey: 'maincar-voicemail-greetings/org-a/greeting.mp3', status: 'active',
    })

    const res = await post({})

    expect(getRecordingDownloadUrlMock).toHaveBeenCalledWith('maincar-voicemail-greetings/org-a/greeting.mp3')
    expect(res.text).toContain('<Play>https://s3.example.com/signed-greeting.mp3</Play>')
    expect(res.text).not.toContain("We can't take your call")
  })

  it('plays the default greeting when the org has none uploaded', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(null)

    const res = await post({})

    expect(getRecordingDownloadUrlMock).not.toHaveBeenCalled()
    expect(res.text).toContain("We can't take your call right now. Please leave a message after the tone.")
    expect(res.text).not.toContain('<Play>')
  })

  it('records with the voicemail-recording callback, scoped to completed', async () => {
    const res = await post({})

    expect(res.text).toMatch(/recordingStatusCallback="[^"]*\/api\/twilio\/voice\/voicemail-recording"/)
    expect(res.text).toContain('recordingStatusCallbackEvent="completed"')
  })

  it('creates the Voicemail row scoped to the org, keyed by callSid', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue({
      id: 'vg-1',
      orgId: 'org-a',
      storageKey: 'maincar-voicemail-greetings/org-a/greeting.mp3', status: 'active',
    })

    await post({ To: '+13035550199', From: '+12025550123' })

    expect(prismaMock.voicemail.upsert).toHaveBeenCalledWith({
      where: { callSid: CALL_SID },
      create: {
        orgId: 'org-a',
        callSid: CALL_SID,
        fromE164: '+12025550123',
        toE164: '+13035550199',
        greeting: 'maincar-voicemail-greetings/org-a/greeting.mp3',
      },
      update: {},
    })
  })

  it('upserts rather than creates, so a Twilio retry of the same CallSid does not fail on a duplicate key', async () => {
    await post({})
    await post({})

    expect(prismaMock.voicemail.upsert).toHaveBeenCalledTimes(2)
    // Both calls key on the same callSid — never a bare create that would collide.
    for (const call of prismaMock.voicemail.upsert.mock.calls) {
      expect(call[0].where).toEqual({ callSid: CALL_SID })
    }
  })
})

// ============================================================
// POST /api/twilio/voice/voicemail-recording — inbound voicemail recording-progress callback
// ============================================================
const VOICEMAIL_RECORDING_URL = '/api/twilio/voice/voicemail-recording'

/** POSTs a Twilio-shaped voicemail recording-status callback with a signature header. */
function postVoicemailRecording(body: Record<string, string>, signature: string | null = SIG) {
  const req = request(app).post(VOICEMAIL_RECORDING_URL).type('form')
  if (signature !== null) req.set('X-Twilio-Signature', signature)
  return req.send(body)
}

describe('voicemail-recording callback — signature', () => {
  it('403s on a bad signature, before any lookup', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postVoicemailRecording({ CallSid: CALL_SID, RecordingSid: 'RE0123456789abcdef' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Invalid Twilio signature' })
    expect(prismaMock.voicemail.findFirst).not.toHaveBeenCalled()
    expect(queueUploadVoicemailMock).not.toHaveBeenCalled()
  })

  it('403s when the signature header is absent', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postVoicemailRecording({ CallSid: CALL_SID, RecordingSid: 'RE0123456789abcdef' }, null)

    expect(res.status).toBe(403)
    expect(prismaMock.voicemail.findFirst).not.toHaveBeenCalled()
  })
})

describe('voicemail-recording callback — lookup', () => {
  it('looks the voicemail up by CallSid', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue({ id: 'voicemail-1', orgId: 'org-a', callSid: CALL_SID })

    await postVoicemailRecording({ CallSid: CALL_SID, RecordingSid: 'RE0123456789abcdef' })

    expect(prismaMock.voicemail.findFirst).toHaveBeenCalledWith({ where: { callSid: CALL_SID } })
  })

  it('404s when no voicemail matches the CallSid, and enqueues nothing', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue(null)

    const res = await postVoicemailRecording({ CallSid: 'CAunknownSID', RecordingSid: 'RE0123456789abcdef' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Voicemail not found' })
    expect(queueUploadVoicemailMock).not.toHaveBeenCalled()
  })
})

describe('voicemail-recording callback — upload pipeline', () => {
  it('queues the upload job with the voicemail id and RecordingSid', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue({ id: 'voicemail-1', orgId: 'org-a', callSid: CALL_SID })

    const res = await postVoicemailRecording({ CallSid: CALL_SID, RecordingSid: 'RE0123456789abcdef' })

    expect(res.status).toBe(200)
    expect(queueUploadVoicemailMock).toHaveBeenCalledTimes(1)
    expect(queueUploadVoicemailMock).toHaveBeenCalledWith('voicemail-1', 'RE0123456789abcdef')
  })

  it('does not queue the upload job when there is no RecordingSid', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue({ id: 'voicemail-1', orgId: 'org-a', callSid: CALL_SID })

    await postVoicemailRecording({ CallSid: CALL_SID })

    expect(queueUploadVoicemailMock).not.toHaveBeenCalled()
  })
})

describe('voicemail-recording callback — acknowledgement', () => {
  it('200s with a keyed body Twilio can ignore', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue({ id: 'voicemail-1', orgId: 'org-a', callSid: CALL_SID })

    const res = await postVoicemailRecording({ CallSid: CALL_SID, RecordingSid: 'RE0123456789abcdef' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
  })
})

// ============================================================
// POST /api/twilio/voice/status — the call-progress status callback
// ============================================================
const STATUS_URL = '/api/twilio/voice/status'

/** POSTs a Twilio-shaped status callback with a signature header. */
function postStatus(body: Record<string, string>, signature: string | null = SIG) {
  const req = request(app).post(STATUS_URL).type('form')
  if (signature !== null) req.set('X-Twilio-Signature', signature)
  return req.send(body)
}

/** The single updateMany write the handler made, or undefined if it made none. */
function statusWrite() {
  return prismaMock.call.updateMany.mock.calls[0]?.[0] as
    | { where: Record<string, unknown>; data: Record<string, unknown> }
    | undefined
}

describe('status callback — signature', () => {
  it('403s on a bad signature, before any lookup', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postStatus({ CallSid: CALL_SID, CallStatus: 'completed' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Invalid Twilio signature' })
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })

  it('403s when the signature header is absent', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postStatus({ CallSid: CALL_SID, CallStatus: 'completed' }, null)

    expect(res.status).toBe(403)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })
})

describe('status callback — lookup', () => {
  it('looks the call up by CallSid', async () => {
    await postStatus({ CallSid: CALL_SID, CallStatus: 'ringing' })

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({ where: { twilioCallSid: CALL_SID } })
  })

  it('404s when no call matches the CallSid, and writes nothing', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await postStatus({ CallSid: 'CAunknownSID', CallStatus: 'completed' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Call not found' })
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })
})

describe('status callback — CallStatus → Call.status mapping', () => {
  // Twilio's vocabulary maps one-to-one onto Call.status; every value is proven.
  it.each([
    'queued',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'failed',
    'no-answer',
    'canceled',
  ])('maps %s onto Call.status, scoped by orgId', async (callStatus) => {
    const res = await postStatus({ CallSid: CALL_SID, CallStatus: callStatus })

    expect(res.status).toBe(200)
    const write = statusWrite()
    expect(write?.where).toEqual({ id: 'call-1', orgId: 'org-a' })
    expect(write?.data.status).toBe(callStatus)
    // update-by-id is never used for org-scoped data.
    expect(prismaMock.call.update).not.toHaveBeenCalled()
  })

  it('leaves status unchanged for an unrecognized CallStatus', async () => {
    const res = await postStatus({ CallSid: CALL_SID, CallStatus: 'martian' })

    expect(res.status).toBe(200)
    // Nothing to write: no known status, no duration.
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })
})

describe('status callback — terminal statuses set endedAt', () => {
  it.each(['completed', 'busy', 'failed', 'no-answer', 'canceled'])(
    'stamps endedAt on %s',
    async (callStatus) => {
      await postStatus({ CallSid: CALL_SID, CallStatus: callStatus })

      expect(statusWrite()?.data.endedAt).toBeInstanceOf(Date)
    },
  )

  it.each(['queued', 'ringing', 'in-progress'])(
    'does not stamp endedAt on the non-terminal status %s',
    async (callStatus) => {
      await postStatus({ CallSid: CALL_SID, CallStatus: callStatus })

      expect(statusWrite()?.data).not.toHaveProperty('endedAt')
    },
  )
})

describe('status callback — durationS', () => {
  it('records durationS from CallDuration on completion', async () => {
    await postStatus({ CallSid: CALL_SID, CallStatus: 'completed', CallDuration: '42' })

    const write = statusWrite()
    expect(write?.data.durationS).toBe(42)
    expect(write?.data.status).toBe('completed')
    expect(write?.data.endedAt).toBeInstanceOf(Date)
  })

  it('omits durationS when CallDuration is absent', async () => {
    await postStatus({ CallSid: CALL_SID, CallStatus: 'ringing' })

    expect(statusWrite()?.data).not.toHaveProperty('durationS')
  })

  it('omits durationS when CallDuration is not a number', async () => {
    await postStatus({ CallSid: CALL_SID, CallStatus: 'completed', CallDuration: 'not-a-number' })

    expect(statusWrite()?.data).not.toHaveProperty('durationS')
  })
})

describe('status callback — recording pipeline', () => {
  it('queues the upload job with the call id and RecordingSid when a recording exists', async () => {
    const res = await postStatus({
      CallSid: CALL_SID,
      CallStatus: 'completed',
      CallDuration: '30',
      RecordingSid: 'RE0123456789abcdef',
    })

    expect(res.status).toBe(200)
    expect(queueUploadRecordingMock).toHaveBeenCalledTimes(1)
    expect(queueUploadRecordingMock).toHaveBeenCalledWith('call-1', 'RE0123456789abcdef')
  })

  it('does not queue the upload job when there is no RecordingSid', async () => {
    await postStatus({ CallSid: CALL_SID, CallStatus: 'completed', CallDuration: '30' })

    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })
})

describe('status callback — acknowledgement', () => {
  it('200s with a keyed body Twilio can ignore', async () => {
    const res = await postStatus({ CallSid: CALL_SID, CallStatus: 'in-progress' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
  })
})

// ============================================================
// POST /api/twilio/voice/recording-status — the recording-progress callback
// ============================================================
const RECORDING_STATUS_URL = '/api/twilio/voice/recording-status'
const RECORDING_SID = 'RE0123456789abcdef'

/** POSTs a Twilio-shaped recording-status callback with a signature header. */
function postRecordingStatus(body: Record<string, string>, signature: string | null = SIG) {
  const req = request(app).post(RECORDING_STATUS_URL).type('form')
  if (signature !== null) req.set('X-Twilio-Signature', signature)
  return req.send(body)
}

describe('recording-status callback — signature', () => {
  it('403s on a bad signature, before any lookup', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postRecordingStatus({
      CallSid: CALL_SID,
      RecordingSid: RECORDING_SID,
      RecordingStatus: 'completed',
    })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Invalid Twilio signature' })
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })

  it('403s when the signature header is absent', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await postRecordingStatus(
      { CallSid: CALL_SID, RecordingSid: RECORDING_SID, RecordingStatus: 'completed' },
      null,
    )

    expect(res.status).toBe(403)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })
})

describe('recording-status callback — lookup', () => {
  it('looks the call up by CallSid', async () => {
    await postRecordingStatus({
      CallSid: CALL_SID,
      RecordingSid: RECORDING_SID,
      RecordingStatus: 'completed',
    })

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({ where: { twilioCallSid: CALL_SID } })
  })

  it('404s when no call matches the CallSid, and writes nothing', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await postRecordingStatus({
      CallSid: 'CAunknownSID',
      RecordingSid: RECORDING_SID,
      RecordingStatus: 'completed',
    })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Call not found' })
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })
})

describe('recording-status callback — recordingEnabled', () => {
  it.each(['in-progress', 'completed'])(
    'sets recordingEnabled true, scoped by orgId, on RecordingStatus %s',
    async (recordingStatus) => {
      await postRecordingStatus({ CallSid: CALL_SID, RecordingSid: RECORDING_SID, RecordingStatus: recordingStatus })

      expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
        where: { id: 'call-1', orgId: 'org-a' },
        data: { recordingEnabled: true },
      })
      // update-by-id is never used for org-scoped data.
      expect(prismaMock.call.update).not.toHaveBeenCalled()
    },
  )

  it.each(['failed', 'absent'])(
    'leaves recordingEnabled untouched on RecordingStatus %s',
    async (recordingStatus) => {
      await postRecordingStatus({ CallSid: CALL_SID, RecordingSid: RECORDING_SID, RecordingStatus: recordingStatus })

      expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    },
  )
})

describe('recording-status callback — upload pipeline', () => {
  it('queues the upload job with the call id and RecordingSid on RecordingStatus completed', async () => {
    const res = await postRecordingStatus({
      CallSid: CALL_SID,
      RecordingSid: RECORDING_SID,
      RecordingStatus: 'completed',
    })

    expect(res.status).toBe(200)
    expect(queueUploadRecordingMock).toHaveBeenCalledTimes(1)
    expect(queueUploadRecordingMock).toHaveBeenCalledWith('call-1', RECORDING_SID)
  })

  it('does not queue the upload job on RecordingStatus in-progress — no media exists yet', async () => {
    await postRecordingStatus({ CallSid: CALL_SID, RecordingSid: RECORDING_SID, RecordingStatus: 'in-progress' })

    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })

  it('does not queue the upload job on RecordingStatus failed', async () => {
    await postRecordingStatus({ CallSid: CALL_SID, RecordingSid: RECORDING_SID, RecordingStatus: 'failed' })

    expect(queueUploadRecordingMock).not.toHaveBeenCalled()
  })
})

describe('recording-status callback — acknowledgement', () => {
  it('200s with a keyed body Twilio can ignore', async () => {
    const res = await postRecordingStatus({
      CallSid: CALL_SID,
      RecordingSid: RECORDING_SID,
      RecordingStatus: 'completed',
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
  })
})
