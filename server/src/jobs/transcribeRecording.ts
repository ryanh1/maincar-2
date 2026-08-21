import { transcribeRecording as transcribeAudio, openaiErrorStatus } from '../../dependencies/openai.js'
import { getRecordingDownloadUrl } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { JOB_TRANSCRIBE_RECORDING, sendJob, workJob } from './queue.js'

// The job that turns a stored call recording into text: presign the recording's
// S3 key so OpenAI can read it, send it to Whisper, and write the transcript onto
// the Call row.
//
// Like uploadRecording.ts this is at-least-once, so it is written to be safe to
// run twice: a row already marked `done` is left untouched, and a call with no
// recording is settled as `skipped-not-recorded` WITHOUT ever touching OpenAI —
// there is nothing to transcribe and a Whisper call would just cost money for a
// guaranteed empty answer.

/** Everything the job needs. The Call row supplies orgId and the recording key. */
export interface TranscribeRecordingPayload {
  /** The Call row whose recording should be transcribed. */
  callId: string
}

/**
 * Where pg-boss is in its retry budget for this run.
 *
 * Passed in rather than read from a queue handle so the handler stays a plain
 * function a test can call directly, exactly as uploadRecording.ts does.
 */
export interface TranscribeRecordingAttempt {
  /** Retries already spent. 0 on the first run. */
  retryCount: number
  /** The ceiling from the queue/send options. */
  retryLimit: number
}

/** One retry, then the row is marked failed. Mirrors the queue default. */
export const TRANSCRIBE_RECORDING_RETRY_LIMIT = 1

/** Seconds pg-boss waits before the retry — long enough for an S3/OpenAI blip to pass. */
export const TRANSCRIBE_RECORDING_RETRY_DELAY_SECONDS = 30

/**
 * Mark the transcription failed.
 *
 * `updateMany` with orgId, never `update({ where: { id } })` — the org filter is
 * defence in depth even here, where the id came off a row this process just read.
 * `transcriptStatus: { not: 'done' }` makes it a compare-and-set: if the
 * transcription had in fact succeeded on another delivery, this writes nothing
 * rather than dragging a finished transcript back to failed. It touches ONLY
 * `transcriptStatus` — the transcript text and the call's own lifecycle are
 * different facts and are never overwritten by a transcription problem.
 */
async function markTranscriptFailed(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, transcriptStatus: { not: 'done' } },
    data: { transcriptStatus: 'failed' },
  })
}

/**
 * Transcribe one call's recording and write the text onto the Call row.
 *
 * Exported as a plain function, with no pg-boss types in its signature, so the
 * whole decision tree is unit-testable without a queue.
 *
 * Contract with the queue:
 *   - returns normally  → the job is settled, do not retry
 *   - throws            → pg-boss retries, up to `attempt.retryLimit`
 */
export async function transcribeRecordingJob(
  payload: TranscribeRecordingPayload,
  attempt: TranscribeRecordingAttempt = {
    retryCount: 0,
    retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT,
  },
): Promise<void> {
  const { callId } = payload

  // --- Load the row ---
  //
  // By id alone: a job has no caller and no token to take an orgId from. The id is
  // not user input — it came from a row this server wrote — and the orgId read
  // back here is what every write below is scoped to.
  const row = await prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, recordingUrl: true, transcriptStatus: true },
  })

  if (!row) {
    // The call was deleted between enqueue and pickup. Nothing to transcribe.
    logger.warn({ callId }, 'transcribe recording: call row is gone, nothing to transcribe')
    return
  }

  // --- Idempotency guard ---
  //
  // pg-boss is at-least-once. A worker that already transcribed this recording and
  // then died leaves the job to be delivered again. `transcriptStatus: "done"` is
  // the proof the work is finished, and re-running would spend another Whisper
  // call for the same answer.
  if (row.transcriptStatus === 'done') {
    logger.info(
      { callId, orgId: row.orgId },
      'transcribe recording: already transcribed, skipping',
    )
    return
  }

  // --- No recording → skip, without calling OpenAI ---
  //
  // A call can complete without ever being recorded (consent declined, recording
  // disabled). There is nothing to transcribe, so the row is settled as
  // `skipped-not-recorded` and OpenAI is never touched. `transcriptStatus:
  // { not: 'done' }` keeps this from clobbering a transcript that a racing
  // delivery had already written.
  if (!row.recordingUrl) {
    await prisma.call.updateMany({
      where: { id: callId, orgId: row.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'skipped-not-recorded' },
    })
    logger.info(
      { callId, orgId: row.orgId },
      'transcribe recording: no recording on the call, marked skipped-not-recorded',
    )
    return
  }

  // --- Presign and transcribe ---
  //
  // `recordingUrl` is a BARE S3 object key, not a link OpenAI can open, so it is
  // presigned into a time-limited GET URL first. Both steps live in one try
  // because they are the single unit of work: a URL we could not turn into text is
  // worth nothing, and nothing below writes the transcript until Whisper returns
  // it.
  let transcript: string
  try {
    const audioUrl = await getRecordingDownloadUrl(row.recordingUrl)
    transcript = await transcribeAudio(audioUrl)
  } catch (error) {
    const status = openaiErrorStatus(error)
    const retryable = attempt.retryCount < attempt.retryLimit

    if (retryable) {
      // Leave the row untouched and rethrow: pg-boss owns the retry, and the
      // idempotency guard above still holds if this attempt had in fact finished.
      logger.warn(
        { callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
        'transcribe recording: failure, handing it back to the queue',
      )
      throw error
    }

    // The retry budget is spent. Note what is NOT logged: no API key.
    logger.error(
      { callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
      'transcribe recording: could not transcribe the recording, giving up',
    )
    await markTranscriptFailed(callId, row.orgId)
    return
  }

  // --- Record it ---
  //
  // Transcript text and `transcriptStatus` are written together, only now that
  // Whisper has returned. `transcriptStatus: { not: 'done' }` in the filter so a
  // duplicate delivery that slipped past the guard above still cannot double-write.
  const updated = await prisma.call.updateMany({
    where: { id: callId, orgId: row.orgId, transcriptStatus: { not: 'done' } },
    data: { transcript, transcriptStatus: 'done' },
  })

  if (updated.count === 0) {
    // The transcription went through but the row was deleted or already settled by
    // another delivery. Leave it and move on.
    logger.warn(
      { callId, orgId: row.orgId },
      'transcribe recording: transcribed but the row was gone or already settled',
    )
    return
  }

  logger.info({ callId, orgId: row.orgId }, 'transcribe recording: transcribed')
}

/**
 * Enqueue a transcription run for one call.
 *
 * The recording-upload job (jobs/uploadRecording.ts) calls this once a recording
 * is stored and ready to transcribe, handing it the call id.
 */
export async function queueTranscribeRecording(callId: string): Promise<string | null> {
  const payload: TranscribeRecordingPayload = { callId }
  return sendJob(JOB_TRANSCRIBE_RECORDING, payload, {
    retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT,
    retryDelay: TRANSCRIBE_RECORDING_RETRY_DELAY_SECONDS,
  })
}

/**
 * Attach the worker. Called once, from index.ts — never from app.ts.
 *
 * `batchSize: 1` because each job makes its own Whisper call; there is nothing to
 * gain from running several at once and a partial batch failure would be harder to
 * reason about than a queue of singles.
 */
export async function registerTranscribeRecordingWorker(): Promise<string> {
  return workJob<TranscribeRecordingPayload>(
    JOB_TRANSCRIBE_RECORDING,
    { batchSize: 1 },
    async (job) => {
      await transcribeRecordingJob(job.data, {
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
      })
    },
  )
}
