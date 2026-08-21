// Unit tests for the outbound-calling half of the Twilio wrapper
// (dependencies/twilio.ts): minting a browser Voice SDK access token, building the
// TwiML that bridges a browser call to a destination, hanging a call up, fetching
// and deleting a recording, and verifying a webhook signature.
//
// The routes and jobs that use these mock this module wholesale, so its real body
// only runs here. The Twilio SDK is mocked at the module boundary and `fetch` is
// stubbed, so there is no network, no account, and not a cent of spend. config.ts
// is mocked so the credentials are deterministic and never touched by the
// repo-root .env dotenv would otherwise load.
//
// The number-provisioning functions in the same module (listAvailableLocalNumbers,
// getLocalNumberMonthlyPrice, buyPhoneNumber) belong to the number-purchase issue,
// not to outbound calling, so they are out of scope here and covered elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({
  PUBLIC_BASE_URL: 'https://api.test.example.com',
  TWILIO_ACCOUNT_SID: 'ACtestaccountsid',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_API_KEY_SID: 'SKtestapikeysid',
  TWILIO_API_KEY_SECRET: 'test-api-key-secret',
  TWILIO_TWIML_APP_SID: 'APtesttwimlappsid',
}))

const {
  twilioCtor,
  callsUpdateMock,
  callsFnMock,
  recordingsRemoveMock,
  recordingsFnMock,
  validateRequestMock,
  dialMock,
  numberMock,
  accessTokenCtor,
  accessTokenAddGrantMock,
  voiceGrantCtor,
} = vi.hoisted(() => {
  const callsUpdateMock = vi.fn()
  const callsFnMock = vi.fn((_sid: string) => ({ update: callsUpdateMock }))
  const recordingsRemoveMock = vi.fn()
  const recordingsFnMock = vi.fn((_sid: string) => ({ remove: recordingsRemoveMock }))
  const validateRequestMock = vi.fn()
  const numberMock = vi.fn()
  const dialMock = vi.fn(() => ({ number: numberMock }))
  const twilioCtor = vi.fn(() => ({
    calls: callsFnMock,
    recordings: recordingsFnMock,
  }))
  const accessTokenAddGrantMock = vi.fn()
  const accessTokenToJwtMock = vi.fn(() => 'fake.jwt.token')
  // `function`, not an arrow, because mintVoiceAccessToken calls this with `new` —
  // an arrow function cannot be a constructor.
  const accessTokenCtor = vi.fn(function accessTokenCtor() {
    return { addGrant: accessTokenAddGrantMock, toJwt: accessTokenToJwtMock }
  })
  const voiceGrantCtor = vi.fn(function voiceGrantCtor() {})
  return {
    twilioCtor,
    callsUpdateMock,
    callsFnMock,
    recordingsRemoveMock,
    recordingsFnMock,
    validateRequestMock,
    dialMock,
    numberMock,
    accessTokenCtor,
    accessTokenAddGrantMock,
    accessTokenToJwtMock,
    voiceGrantCtor,
  }
})

vi.mock('twilio', () => {
  // The default export is the client factory, and it also carries validateRequest,
  // the jwt namespace, and the twiml builders as static members — exactly the
  // SDK's shape. VoiceResponse's dial() returns an object whose number() is the
  // only method buildBridgeTwiml calls, so only that much of the real builder
  // needs modeling.
  Object.assign(accessTokenCtor, { VoiceGrant: voiceGrantCtor })
  const twilio = Object.assign(twilioCtor, {
    validateRequest: validateRequestMock,
    jwt: { AccessToken: accessTokenCtor },
    twiml: {
      VoiceResponse: class {
        dial = dialMock
        toString() {
          return '<Response><Dial/></Response>'
        }
      },
    },
  })
  return { default: twilio }
})

import {
  buildBridgeTwiml,
  deleteRecording,
  fetchRecordingMp3,
  hangUpCall,
  mintVoiceAccessToken,
  twilioErrorStatus,
  verifyTwilioSignature,
  VoiceTokenConfigMissingError,
  WebhookBaseUrlMissingError,
} from '../twilio.js'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  callsUpdateMock.mockResolvedValue({ sid: 'CA123', status: 'completed' })
  recordingsRemoveMock.mockResolvedValue(undefined)
  validateRequestMock.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('twilioErrorStatus', () => {
  it('reads a numeric status off a Twilio REST error, and null otherwise', () => {
    expect(twilioErrorStatus({ status: 404 })).toBe(404)
    expect(twilioErrorStatus(new Error('socket hang up'))).toBeNull()
    expect(twilioErrorStatus(null)).toBeNull()
  })
})

describe('buildBridgeTwiml', () => {
  it('dials the destination through <Number>, presenting the caller ID, off PUBLIC_BASE_URL', () => {
    const twiml = buildBridgeTwiml({ toE164: '+13035550199', callerId: '+12025550123', record: false })

    expect(twiml).toContain('<Response>')
    // No consent, no record attrs at all — not even a `record: false` on the SDK
    // call, which Twilio would treat identically but which would misstate why.
    expect(dialMock).toHaveBeenCalledWith({ callerId: '+12025550123' })
    expect(numberMock).toHaveBeenCalledTimes(1)
    const [attrs, number] = numberMock.mock.calls[0]
    expect(number).toBe('+13035550199')
    // The bridged leg carries its OWN statusCallback, off the public base — this
    // is what keeps POST /voice/status driving Call.status even though nothing
    // called calls.create() this time.
    expect(attrs.statusCallback).toBe('https://api.test.example.com/api/twilio/voice/status')
    expect(attrs.statusCallbackMethod).toBe('POST')
    expect(attrs.statusCallbackEvent).toEqual(['initiated', 'ringing', 'answered', 'completed'])
  })

  it('tells Twilio to record when record is true, with a recordingStatusCallback off PUBLIC_BASE_URL', () => {
    buildBridgeTwiml({ toE164: '+13035550199', callerId: '+12025550123', record: true })

    expect(dialMock).toHaveBeenCalledWith({
      callerId: '+12025550123',
      record: 'record-from-answer',
      recordingStatusCallback: 'https://api.test.example.com/api/twilio/voice/recording-status',
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: ['in-progress', 'completed'],
    })
  })

  it('throws WebhookBaseUrlMissingError when PUBLIC_BASE_URL is unset, building nothing', async () => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({
      PUBLIC_BASE_URL: '',
      TWILIO_ACCOUNT_SID: 'ACtestaccountsid',
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_API_KEY_SID: 'SKtestapikeysid',
      TWILIO_API_KEY_SECRET: 'test-api-key-secret',
      TWILIO_TWIML_APP_SID: 'APtesttwimlappsid',
    }))
    try {
      const fresh = await import('../twilio.js')
      expect(() =>
        fresh.buildBridgeTwiml({ toE164: '+1', callerId: '+1', record: false }),
      ).toThrow(fresh.WebhookBaseUrlMissingError)
      expect(dialMock).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })

  it('exposes WebhookBaseUrlMissingError with a stable name', () => {
    expect(new WebhookBaseUrlMissingError().name).toBe('WebhookBaseUrlMissingError')
  })
})

describe('mintVoiceAccessToken', () => {
  it('mints a token for the identity, granting only outgoing calls through our TwiML App', () => {
    const result = mintVoiceAccessToken('user-1')

    expect(result).toEqual({ token: 'fake.jwt.token', identity: 'user-1', ttlSeconds: 3600 })
    expect(accessTokenCtor).toHaveBeenCalledWith('ACtestaccountsid', 'SKtestapikeysid', 'test-api-key-secret', {
      identity: 'user-1',
      ttl: 3600,
    })
    expect(voiceGrantCtor).toHaveBeenCalledWith({
      outgoingApplicationSid: 'APtesttwimlappsid',
      incomingAllow: false,
    })
    expect(accessTokenAddGrantMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['TWILIO_ACCOUNT_SID', { TWILIO_ACCOUNT_SID: '' }],
    ['TWILIO_API_KEY_SID', { TWILIO_API_KEY_SID: '' }],
    ['TWILIO_API_KEY_SECRET', { TWILIO_API_KEY_SECRET: '' }],
    ['TWILIO_TWIML_APP_SID', { TWILIO_TWIML_APP_SID: '' }],
  ])('throws VoiceTokenConfigMissingError when %s is unset, minting nothing', async (_name, override) => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({
      PUBLIC_BASE_URL: 'https://api.test.example.com',
      TWILIO_ACCOUNT_SID: 'ACtestaccountsid',
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_API_KEY_SID: 'SKtestapikeysid',
      TWILIO_API_KEY_SECRET: 'test-api-key-secret',
      TWILIO_TWIML_APP_SID: 'APtesttwimlappsid',
      ...override,
    }))
    try {
      const fresh = await import('../twilio.js')
      expect(() => fresh.mintVoiceAccessToken('user-1')).toThrow(fresh.VoiceTokenConfigMissingError)
      expect(accessTokenCtor).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })

  it('exposes VoiceTokenConfigMissingError with a stable name', () => {
    expect(new VoiceTokenConfigMissingError().name).toBe('VoiceTokenConfigMissingError')
  })
})

describe('hangUpCall', () => {
  it('updates the live call to completed and returns Twilio’s echo', async () => {
    const result = await hangUpCall('CA123')

    expect(result).toEqual({ sid: 'CA123', status: 'completed' })
    expect(callsFnMock).toHaveBeenCalledWith('CA123')
    expect(callsUpdateMock).toHaveBeenCalledWith({ status: 'completed' })
  })
})

describe('deleteRecording', () => {
  it('removes the recording by SID', async () => {
    await deleteRecording('RE123')

    expect(recordingsFnMock).toHaveBeenCalledWith('RE123')
    expect(recordingsRemoveMock).toHaveBeenCalledTimes(1)
  })
})

describe('verifyTwilioSignature', () => {
  it('delegates to Twilio’s validateRequest with the token, signature, url, and params', () => {
    const params = { CallSid: 'CA123', Direction: 'outbound-api' }
    const ok = verifyTwilioSignature({ signature: 'sig', url: 'https://x/y', params })

    expect(ok).toBe(true)
    expect(validateRequestMock).toHaveBeenCalledWith('test-auth-token', 'sig', 'https://x/y', params)
  })

  it('returns false without validating when the signature header is absent', () => {
    expect(verifyTwilioSignature({ signature: undefined, url: 'https://x/y', params: {} })).toBe(
      false,
    )
    expect(validateRequestMock).not.toHaveBeenCalled()
  })

  it('returns false when validateRequest rejects the request', () => {
    validateRequestMock.mockReturnValue(false)
    expect(verifyTwilioSignature({ signature: 'sig', url: 'https://x/y', params: {} })).toBe(false)
  })
})

describe('fetchRecordingMp3', () => {
  it('downloads the MP3 with HTTP Basic auth and returns the bytes and content type', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => bytes,
    })

    const media = await fetchRecordingMp3('RE123')

    expect(media.contentType).toBe('audio/mpeg')
    expect(Buffer.isBuffer(media.data)).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACtestaccountsid/Recordings/RE123.mp3',
    )
    const expectedAuth = Buffer.from('ACtestaccountsid:test-auth-token').toString('base64')
    expect(opts.headers.Authorization).toBe(`Basic ${expectedAuth}`)
  })

  it('defaults the content type to audio/mpeg when the response omits it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(2),
    })

    const media = await fetchRecordingMp3('RE123')
    expect(media.contentType).toBe('audio/mpeg')
  })

  it('throws a status-bearing error on a non-2xx, so the caller can split transient from permanent', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const err = await fetchRecordingMp3('RE123').catch((e) => e)
    expect(twilioErrorStatus(err)).toBe(404)
  })

  it('throws a named error when Twilio credentials are not configured', async () => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({
      PUBLIC_BASE_URL: 'https://api.test.example.com',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
    }))
    try {
      const fresh = await import('../twilio.js')
      await expect(fresh.fetchRecordingMp3('RE123')).rejects.toThrow('Twilio is not configured')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })
})

describe('when the Twilio client is not configured', () => {
  it('throws a named error rather than building an SDK client', async () => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({
      PUBLIC_BASE_URL: 'https://api.test.example.com',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
    }))
    try {
      const fresh = await import('../twilio.js')
      await expect(fresh.deleteRecording('RE123')).rejects.toThrow('Twilio is not configured')
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })
})
