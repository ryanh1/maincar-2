import { OPENAI_API_KEY } from '../src/config.js'

// The OpenAI API is called HERE and nowhere else (CLAUDE.md → Third-party
// APIs / SDKs). Job and service code calls the function below; it never touches
// the OpenAI credential and never sees an OpenAI response shape.
//
// Done over plain `fetch`, not the OpenAI SDK, for two reasons: the codebase
// prefers fetch to a new dependency (dependencies-and-config.md), and this mirrors
// twilio.ts `fetchRecordingMp3`, which already downloads media directly — so every
// OpenAI credential read stays inside this one module without pulling an SDK into
// a tree whose package.json is under concurrent edit.

/** The Whisper model used for speech-to-text. */
export const TRANSCRIBE_MODEL = 'whisper-1'

/** OpenAI's audio-transcription endpoint. */
const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'

/**
 * The HTTP status attached to a failure from this module, or null if the error
 * carried none.
 *
 * Exported so a caller can tell a permanent client error (a 4xx: a bad key, an
 * object that is gone) from a transient one (a 5xx or 429) WITHOUT importing any
 * OpenAI type — the same shape twilioErrorStatus reads.
 */
export function openaiErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * Transcribe one call recording to text.
 *
 * `audioUrl` is a presigned, time-limited GET URL for the recording object — the
 * caller signs `Call.recordingUrl` (a bare S3 key) with s3.getRecordingDownloadUrl
 * before handing it here. The bytes are pulled down from that URL and posted to
 * OpenAI as multipart form data, because the transcription API takes the file
 * itself, not a link it could fetch on our behalf.
 *
 * Both the download and the OpenAI call turn a non-2xx into an Error carrying the
 * numeric HTTP `status`, so a caller's retry logic reads one shape (see
 * `openaiErrorStatus`). A missing key is a named throw at call time rather than a
 * process-killing import, matching the lazy Twilio/S3 clients.
 */
export async function transcribeRecording(audioUrl: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI is not configured. Set OPENAI_API_KEY in .env (see .env.example).')
  }

  // --- Pull the audio down from the presigned URL ---
  const audio = await fetch(audioUrl)
  if (!audio.ok) {
    // Shaped like the OpenAI failure below (a numeric `status`) so the caller's
    // transient-vs-permanent decision does not need a second code path.
    throw Object.assign(new Error(`Recording download failed (${audio.status})`), {
      status: audio.status,
    })
  }
  const bytes = await audio.arrayBuffer()
  const contentType = audio.headers.get('content-type') ?? 'audio/mpeg'

  // --- Hand the bytes to Whisper ---
  const form = new FormData()
  form.append('model', TRANSCRIBE_MODEL)
  form.append('file', new Blob([bytes], { type: contentType }), 'recording.mp3')

  const response = await fetch(TRANSCRIPTIONS_URL, {
    method: 'POST',
    // Only the bearer token is set by hand; fetch fills in the multipart
    // Content-Type (with its boundary) from the FormData body.
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  })
  if (!response.ok) {
    throw Object.assign(new Error(`OpenAI transcription failed (${response.status})`), {
      status: response.status,
    })
  }

  const json = (await response.json()) as { text?: unknown }
  if (typeof json.text !== 'string') {
    // A 2xx with no text is not a transcript. Fail loudly rather than store "".
    throw new Error('OpenAI transcription returned no text')
  }
  return json.text
}
