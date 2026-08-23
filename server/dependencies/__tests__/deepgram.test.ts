import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({ DEEPGRAM_API_KEY: 'dg-test-key' }))

import { DEEPGRAM_LISTEN_URL, deepgramErrorStatus, transcribeCallRecording } from '../deepgram.js'

const AUDIO = Buffer.from('dual-channel-mp3')

const RESPONSE = {
  results: {
    channels: [
      { detected_language: 'en', alternatives: [{ confidence: 0.98 }] },
      { detected_language: 'es', alternatives: [{ confidence: 0.97 }] },
    ],
    utterances: [
      {
        channel: 1,
        speaker: 0,
        start: 1.1,
        end: 1.8,
        confidence: 0.97,
        transcript: 'Hola, ¿cómo estás?',
        words: [
          { word: 'Hola', punctuated_word: 'Hola,', start: 1.1, end: 1.3, confidence: 0.99, speaker: 0, speaker_confidence: 0.98 },
          { word: 'como', punctuated_word: 'cómo', start: 1.31, end: 1.5, confidence: 0.98, speaker: 0, speaker_confidence: 0.98 },
        ],
      },
      {
        channel: 0,
        speaker: 1,
        start: 0.2,
        end: 0.9,
        confidence: 0.98,
        transcript: 'Hello there.',
        words: [
          { word: 'Hello', punctuated_word: 'Hello', start: 0.2, end: 0.5, confidence: 0.99, speaker: 1, speaker_confidence: 0.99 },
          { word: 'there', punctuated_word: 'there.', start: 0.51, end: 0.9, confidence: 0.97, speaker: 1, speaker_confidence: 0.99 },
        ],
      },
    ],
  },
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

describe('transcribeCallRecording', () => {
  it('sends server-read recording bytes with the required final-pass options', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => RESPONSE })

    await transcribeCallRecording(AUDIO, 'audio/mpeg')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(DEEPGRAM_LISTEN_URL)
    expect(options).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Token dg-test-key', 'Content-Type': 'audio/mpeg' },
      body: AUDIO,
    })
    const params = new URL(url).searchParams
    expect(params.get('model')).toBe('nova-3-general')
    expect(params.get('multichannel')).toBe('true')
    expect(params.get('diarize_model')).toBe('latest')
    expect(params.get('punctuate')).toBe('true')
    expect(params.get('utterances')).toBe('true')
    expect(params.get('detect_language')).toBe('true')
  })

  it('normalizes deterministic provider data into chronological persisted segments', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => RESPONSE })

    await expect(transcribeCallRecording(AUDIO, 'audio/mpeg')).resolves.toEqual({
      plainText: 'Hello there.\nHola, ¿cómo estás?',
      segments: [
        expect.objectContaining({
          channel: 0,
          speaker: 1,
          speakerKey: 'deepgram:channel:0:speaker:1',
          startMs: 200,
          endMs: 900,
          language: 'en',
          confidence: 0.98,
          text: 'Hello there.',
          words: expect.arrayContaining([
            expect.objectContaining({ word: 'Hello', punctuatedWord: 'Hello', startMs: 200, endMs: 500, confidence: 0.99, language: 'en' }),
          ]),
        }),
        expect.objectContaining({
          channel: 1,
          speaker: 0,
          speakerKey: 'deepgram:channel:1:speaker:0',
          startMs: 1100,
          endMs: 1800,
          language: 'es',
          confidence: 0.97,
          text: 'Hola, ¿cómo estás?',
        }),
      ],
    })
  })

  it('returns an empty completed transcript when a successful recording has no spoken utterances', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      results: { channels: [{ alternatives: [] }], utterances: [] },
    }) })

    await expect(transcribeCallRecording(AUDIO, 'audio/mpeg')).resolves.toEqual({ plainText: '', segments: [] })
  })

  it('rejects an empty-utterance response whose channel data is malformed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      results: { channels: [null], utterances: [] },
    }) })

    await expect(transcribeCallRecording(AUDIO, 'audio/mpeg')).rejects.toThrow('malformed results.channels[0]')
  })

  it('returns a status-bearing error when Deepgram rejects the request', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })

    const error = await transcribeCallRecording(AUDIO, 'audio/mpeg').catch((caught) => caught)
    expect(deepgramErrorStatus(error)).toBe(429)
  })
})
