// Route tests for POST /api/twilio/voice — the Twilio voice webhook.
//
// This route is not authenticated by an ID token; it is authenticated by the
// Twilio request signature. So the tests here are shaped differently from the
// org-scoped routes: they prove the 403 on a bad signature, that a genuine
// outbound-api request looks its Call up by CallSid and returns dial TwiML while
// advancing the row to ringing, that an unknown CallSid is a 404, and that a
// Direction this handler does not dial gets empty TwiML and touches no row.
//
// verifyTwilioSignature is mocked (so no real signature has to be minted), but
// buildDialTwiml/buildEmptyTwiml are kept REAL via importActual, so the assertions
// run against the actual TwiML the SDK produces.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifySignatureMock } = vi.hoisted(() => ({
  prismaMock: {
    call: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
    },
  },
  verifySignatureMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
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
    recordingConsent: 'granted',
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
})

// ============================================================
// Signature — the only thing standing in for auth
// ============================================================
describe('signature verification', () => {
  it('403s when the signature does not verify, before any lookup', async () => {
    verifySignatureMock.mockReturnValue(false)

    const res = await post({ CallSid: CALL_SID, Direction: 'outbound-api' })

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

    const res = await post({ CallSid: CALL_SID, Direction: 'outbound-api' }, null)

    expect(res.status).toBe(403)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })

  it('verifies against the signature header and the posted params', async () => {
    await post({ CallSid: CALL_SID, Direction: 'outbound-api' })

    expect(verifySignatureMock).toHaveBeenCalledTimes(1)
    const args = verifySignatureMock.mock.calls[0][0]
    expect(args.signature).toBe(SIG)
    expect(args.params).toMatchObject({ CallSid: CALL_SID, Direction: 'outbound-api' })
    expect(args.url).toContain(URL)
  })
})

// ============================================================
// Outbound happy path
// ============================================================
describe('outbound-api', () => {
  it('returns dial TwiML for the call’s toE164', async () => {
    const res = await post({ CallSid: CALL_SID, Direction: 'outbound-api' })

    expect(res.status).toBe(200)
    expect(res.type).toBe('text/xml')
    expect(res.text).toContain('<Dial>+13035550199</Dial>')
    expect(res.text).toContain('<Response>')
  })

  it('looks the call up by CallSid', async () => {
    await post({ CallSid: CALL_SID, Direction: 'outbound-api' })

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({
      where: { twilioCallSid: CALL_SID },
    })
  })

  it('advances the row to ringing and stamps startedAt, scoped by orgId', async () => {
    await post({ CallSid: CALL_SID, Direction: 'outbound-api' })

    expect(prismaMock.call.updateMany).toHaveBeenCalledTimes(1)
    const args = prismaMock.call.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'call-1', orgId: 'org-a' })
    expect(args.data.status).toBe('ringing')
    expect(args.data.startedAt).toBeInstanceOf(Date)
    // update-by-id is never used for org-scoped data.
    expect(prismaMock.call.update).not.toHaveBeenCalled()
  })

  it('404s when no call matches the CallSid, and writes nothing', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await post({ CallSid: 'CAunknownSID', Direction: 'outbound-api' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Call not found' })
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// Other directions — not this handler's job yet
// ============================================================
describe('non-outbound direction', () => {
  it('returns empty TwiML and touches no row for an inbound call', async () => {
    const res = await post({ CallSid: CALL_SID, Direction: 'inbound' })

    expect(res.status).toBe(200)
    expect(res.type).toBe('text/xml')
    expect(res.text).toContain('<Response')
    expect(res.text).not.toContain('<Dial>')
    // A Direction this handler does not dial neither looks up nor advances a row.
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })
})
