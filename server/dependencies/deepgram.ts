import { DEEPGRAM_API_KEY } from '../src/config.js'

// Deepgram's pre-recorded endpoint accepts audio bytes directly. Keeping that
// boundary here means jobs never see the credential or provider response shape.
const listenUrl = new URL('https://api.deepgram.com/v1/listen')
for (const [name, value] of Object.entries({
  model: 'nova-3-general',
  multichannel: 'true',
  diarize_model: 'latest',
  punctuate: 'true',
  utterances: 'true',
  detect_language: 'true',
})) listenUrl.searchParams.set(name, value)

export const DEEPGRAM_LISTEN_URL = listenUrl.toString()

export interface DeepgramWord {
  word: string
  punctuatedWord: string
  startMs: number
  endMs: number
  confidence: number
  speaker: number
  speakerConfidence: number | null
  channel: number
  language: string
}

export interface DeepgramSegment {
  channel: number
  speaker: number
  speakerKey: string
  startMs: number
  endMs: number
  confidence: number
  language: string
  text: string
  words: DeepgramWord[]
}

export interface DeepgramTranscript {
  plainText: string
  segments: DeepgramSegment[]
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Deepgram transcription returned malformed ${path}`)
  }
  return value as JsonRecord
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Deepgram transcription returned malformed ${path}`)
  }
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Deepgram transcription returned malformed ${path}`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  const number = nonNegativeNumber(value, path)
  if (!Number.isInteger(number)) throw new Error(`Deepgram transcription returned malformed ${path}`)
  return number
}

function confidence(value: unknown, path: string): number {
  const number = nonNegativeNumber(value, path)
  if (number > 1) throw new Error(`Deepgram transcription returned malformed ${path}`)
  return number
}

function milliseconds(seconds: number, path: string): number {
  const value = Math.round(seconds * 1000)
  if (!Number.isSafeInteger(value)) throw new Error(`Deepgram transcription returned malformed ${path}`)
  return value
}

/** Return a provider HTTP status when one exists, without exposing its body. */
export function deepgramErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * Submit bytes the server read from its private object store to Deepgram's
 * pre-recorded endpoint and normalize only the durable call-review fields.
 */
export async function transcribeCallRecording(
  audio: Buffer,
  contentType: string,
): Promise<DeepgramTranscript> {
  if (!DEEPGRAM_API_KEY) {
    throw new Error('Deepgram is not configured. Set DEEPGRAM_API_KEY in .env (see .env.example).')
  }

  const response = await fetch(DEEPGRAM_LISTEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: audio,
  })
  if (!response.ok) {
    throw Object.assign(new Error(`Deepgram transcription failed (${response.status})`), { status: response.status })
  }

  const root = asRecord(await response.json(), 'response')
  const results = asRecord(root.results, 'results')
  if (!Array.isArray(results.channels) || results.channels.length === 0) {
    throw new Error('Deepgram transcription returned malformed results.channels')
  }

  const languages = results.channels.map((value, index) => {
    const channel = asRecord(value, `results.channels[${index}]`)
    return string(channel.detected_language, `results.channels[${index}].detected_language`)
  })

  if (!Array.isArray(results.utterances) || results.utterances.length === 0) {
    throw new Error('Deepgram transcription returned malformed results.utterances')
  }

  const segments = results.utterances.map((value, index): DeepgramSegment => {
    const utterance = asRecord(value, `results.utterances[${index}]`)
    const channel = nonNegativeInteger(utterance.channel, `results.utterances[${index}].channel`)
    const speaker = nonNegativeInteger(utterance.speaker, `results.utterances[${index}].speaker`)
    const startMs = milliseconds(nonNegativeNumber(utterance.start, `results.utterances[${index}].start`), `results.utterances[${index}].start`)
    const endMs = milliseconds(nonNegativeNumber(utterance.end, `results.utterances[${index}].end`), `results.utterances[${index}].end`)
    if (endMs < startMs || languages[channel] === undefined) {
      throw new Error(`Deepgram transcription returned malformed results.utterances[${index}]`)
    }
    if (!Array.isArray(utterance.words) || utterance.words.length === 0) {
      throw new Error(`Deepgram transcription returned malformed results.utterances[${index}].words`)
    }

    const language = languages[channel]
    const words = utterance.words.map((wordValue, wordIndex): DeepgramWord => {
      const word = asRecord(wordValue, `results.utterances[${index}].words[${wordIndex}]`)
      const wordSpeaker = nonNegativeInteger(word.speaker, `results.utterances[${index}].words[${wordIndex}].speaker`)
      if (wordSpeaker !== speaker) {
        throw new Error(`Deepgram transcription returned malformed results.utterances[${index}].words[${wordIndex}].speaker`)
      }
      const wordStartMs = milliseconds(nonNegativeNumber(word.start, `results.utterances[${index}].words[${wordIndex}].start`), `results.utterances[${index}].words[${wordIndex}].start`)
      const wordEndMs = milliseconds(nonNegativeNumber(word.end, `results.utterances[${index}].words[${wordIndex}].end`), `results.utterances[${index}].words[${wordIndex}].end`)
      if (wordEndMs < wordStartMs) {
        throw new Error(`Deepgram transcription returned malformed results.utterances[${index}].words[${wordIndex}]`)
      }
      const rawWord = string(word.word, `results.utterances[${index}].words[${wordIndex}].word`)
      return {
        word: rawWord,
        punctuatedWord: typeof word.punctuated_word === 'string' ? word.punctuated_word : rawWord,
        startMs: wordStartMs,
        endMs: wordEndMs,
        confidence: confidence(word.confidence, `results.utterances[${index}].words[${wordIndex}].confidence`),
        speaker,
        speakerConfidence: word.speaker_confidence === undefined
          ? null
          : confidence(word.speaker_confidence, `results.utterances[${index}].words[${wordIndex}].speaker_confidence`),
        channel,
        language,
      }
    })

    return {
      channel,
      speaker,
      speakerKey: `deepgram:channel:${channel}:speaker:${speaker}`,
      startMs,
      endMs,
      confidence: confidence(utterance.confidence, `results.utterances[${index}].confidence`),
      language,
      text: string(utterance.transcript, `results.utterances[${index}].transcript`),
      words,
    }
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.channel - right.channel)

  return { plainText: segments.map((segment) => segment.text).join('\n'), segments }
}
