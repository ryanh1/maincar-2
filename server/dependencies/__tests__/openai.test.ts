// Unit tests for the OpenAI wrapper (dependencies/openai.ts).
//
// This is the SDK-boundary module the transcribe job mocks wholesale, so it is
// never exercised through that job — these tests are the only thing that runs its
// real body. Everything external is a stubbed `fetch`: the presigned-URL download
// and the Whisper POST are both HTTP, so no network, no OpenAI account, and not a
// cent of spend. The credential is set in vi.hoisted() so it is in place before
// config.ts reads the environment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// config.ts is mocked so the API key is deterministic and never touched by the
// repo-root .env that dotenv would otherwise load.
vi.mock('../../src/config.js', () => ({ OPENAI_API_KEY: 'sk-test-openai-key' }))

import { openaiErrorStatus, TRANSCRIBE_MODEL, transcribeRecording } from '../openai.js'

const AUDIO_URL = 'https://minio.local/maincar2-local/recordings/call-1.mp3?sig=abc'

/** A fetch Response stand-in carrying just the bits the wrapper reads. */
function fakeResponse(
  init: {
    ok?: boolean
    status?: number
    contentType?: string | null
    body?: ArrayBuffer
    json?: unknown
  } = {},
) {
  const { ok = true, status = 200, contentType = 'audio/mpeg', body, json } = init
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body ?? new ArrayBuffer(8),
    json: async () => json,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('openaiErrorStatus', () => {
  it('reads a numeric status off an error', () => {
    expect(openaiErrorStatus({ status: 429 })).toBe(429)
    expect(openaiErrorStatus(Object.assign(new Error('boom'), { status: 500 }))).toBe(500)
  })

  it('returns null when there is no numeric status', () => {
    expect(openaiErrorStatus(new Error('plain'))).toBeNull()
    expect(openaiErrorStatus({ status: 'nope' })).toBeNull()
    expect(openaiErrorStatus(null)).toBeNull()
    expect(openaiErrorStatus(undefined)).toBeNull()
  })
})

describe('transcribeRecording', () => {
  it('downloads the audio, posts it to Whisper, and returns the text', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ body: new ArrayBuffer(16) }))
      .mockResolvedValueOnce(fakeResponse({ json: { text: 'Hello from the call.' } }))

    const text = await transcribeRecording(AUDIO_URL)

    expect(text).toBe('Hello from the call.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // First call is a bare GET of the presigned URL.
    expect(fetchMock.mock.calls[0][0]).toBe(AUDIO_URL)
    // Second call is the multipart POST to the transcriptions endpoint, bearing
    // the API key and the Whisper model, and nothing that leaks the key elsewhere.
    const [url, opts] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer sk-test-openai-key')
    expect(opts.body).toBeInstanceOf(FormData)
    expect((opts.body as FormData).get('model')).toBe(TRANSCRIBE_MODEL)
    expect((opts.body as FormData).get('file')).toBeInstanceOf(Blob)
  })

  it('throws a status-bearing error when the audio download fails', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: false, status: 404 }))

    await expect(transcribeRecording(AUDIO_URL)).rejects.toMatchObject({ status: 404 })
    // It never reached Whisper.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws a status-bearing error when Whisper rejects the request', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ body: new ArrayBuffer(16) }))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500 }))

    const err = await transcribeRecording(AUDIO_URL).catch((e) => e)
    expect(openaiErrorStatus(err)).toBe(500)
  })

  it('throws rather than storing an empty transcript when Whisper returns no text', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ body: new ArrayBuffer(16) }))
      .mockResolvedValueOnce(fakeResponse({ json: { notText: true } }))

    await expect(transcribeRecording(AUDIO_URL)).rejects.toThrow('no text')
  })

  it('falls back to audio/mpeg when the download omits a content-type', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ contentType: null, body: new ArrayBuffer(4) }))
      .mockResolvedValueOnce(fakeResponse({ json: { text: 'ok' } }))

    await expect(transcribeRecording(AUDIO_URL)).resolves.toBe('ok')
  })

  it('throws a named error when the API key is not configured', async () => {
    vi.resetModules()
    vi.doMock('../../src/config.js', () => ({ OPENAI_API_KEY: '' }))
    try {
      const fresh = await import('../openai.js')
      await expect(fresh.transcribeRecording(AUDIO_URL)).rejects.toThrow('OpenAI is not configured')
      // It never made a request.
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })
})
