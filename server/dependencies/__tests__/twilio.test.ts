// Unit tests for the outbound-calling half of the Twilio wrapper
// (dependencies/twilio.ts): placing a call, hanging one up, fetching and deleting
// a recording, and verifying a webhook signature.
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
}))

const {
  twilioCtor,
  callsCreateMock,
  callsUpdateMock,
  callsFnMock,
  recordingsRemoveMock,
  recordingsFnMock,
  validateRequestMock,
} = vi.hoisted(() => {
  const callsCreateMock = vi.fn()
  const callsUpdateMock = vi.fn()
  const callsFnMock = vi.fn((_sid: string) => ({ update: callsUpdateMock }))
  const recordingsRemoveMock = vi.fn()
  const recordingsFnMock = vi.fn((_sid: string) => ({ remove: recordingsRemoveMock }))
  const validateRequestMock = vi.fn()
  const twilioCtor = vi.fn(() => ({
    // `calls` is both callable — client.calls(sid).update() — and a namespace —
    // client.calls.create(). Object.assign models both on one mock.
    calls: Object.assign(callsFnMock, { create: callsCreateMock }),
    recordings: recordingsFnMock,
  }))
  return {
    twilioCtor,
    callsCreateMock,
    callsUpdateMock,
    callsFnMock,
    recordingsRemoveMock,
    recordingsFnMock,
    validateRequestMock,
  }
})

vi.mock('twilio', () => {
  // The default export is the client factory, and it also carries validateRequest
  // and the twiml builders as static members — exactly the SDK's shape.
  const twilio = Object.assign(twilioCtor, {
    validateRequest: validateRequestMock,
    twiml: { VoiceResponse: class {} },
  })
  return { default: twilio }
})

import {
  deleteRecording,
  fetchRecordingMp3,
  hangUpCall,
  initiateOutboundCall,
  twilioErrorStatus,
  verifyTwilioSignature,
  WebhookBaseUrlMissingError,
} from '../twilio.js'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  callsCreateMock.mockResolvedValue({ sid: 'CA123', status: 'queued' })
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

describe('initiateOutboundCall', () => {
  it('dials to/from and wires both webhook URLs off PUBLIC_BASE_URL, returning only what Twilio confirmed', async () => {
    const result = await initiateOutboundCall({
      to: '+13035550199',
      from: '+12025550123',
      callId: 'call-1',
    })

    expect(result).toEqual({ sid: 'CA123', status: 'queued' })
    expect(callsCreateMock).toHaveBeenCalledTimes(1)
    const arg = callsCreateMock.mock.calls[0][0]
    expect(arg.to).toBe('+13035550199')
    expect(arg.from).toBe('+12025550123')
    // The TwiML URL threads the callId so the voice webhook can find the row, and
    // the status callback is the fixed path — both absolute, off the public base.
    expect(arg.url).toBe('https://api.test.example.com/api/twilio/voice?callId=call-1')
    expect(arg.statusCallback).toBe('https://api.test.example.com/api/twilio/voice/status')
    expect(arg.statusCallbackEvent).toEqual(['initiated', 'ringing', 'answered', 'completed'])
  })

  it('url-encodes the callId on the TwiML URL', async () => {
    await initiateOutboundCall({ to: '+13035550199', from: '+12025550123', callId: 'a b/c' })

    expect(callsCreateMock.mock.calls[0][0].url).toBe(
      'https://api.test.example.com/api/twilio/voice?callId=a%20b%2Fc',
    )
  })

  it('throws WebhookBaseUrlMissingError when PUBLIC_BASE_URL is unset, dialing nothing', async () => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({
      PUBLIC_BASE_URL: '',
      TWILIO_ACCOUNT_SID: 'ACtestaccountsid',
      TWILIO_AUTH_TOKEN: 'test-auth-token',
    }))
    try {
      const fresh = await import('../twilio.js')
      await expect(
        fresh.initiateOutboundCall({ to: '+1', from: '+1', callId: 'c' }),
      ).rejects.toBeInstanceOf(fresh.WebhookBaseUrlMissingError)
      expect(callsCreateMock).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })

  it('exposes WebhookBaseUrlMissingError with a stable name', () => {
    expect(new WebhookBaseUrlMissingError().name).toBe('WebhookBaseUrlMissingError')
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
