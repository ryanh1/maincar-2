import { deleteRecording, fetchRecordingMp3, twilioErrorStatus } from '../../dependencies/twilio.js'
import { putRecording } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { JOB_UPLOAD_RECORDING, sendJob, workJob } from './queue.js'

// The job that turns a finished Twilio recording into an object we own: fetch the
// MP3 from Twilio, put it in S3 under a stable key, point the Call row at that
// key, and then delete Twilio's copy so we are not paying two stores to hold the
// same audio.
//
// Unlike provisionNumber.ts this job spends no money, but it IS at-least-once, so
// it is written to be safe to run twice: the object key is derived from the row,
// so a re-upload overwrites rather than multiplies, and a row that already has a
// recording is left untouched.

/** Everything the job needs. The Call row supplies orgId; Twilio supplies the media. */
export interface UploadRecordingPayload {
  /** The Call row this recording belongs to. */
  callId: string
  /**
   * Twilio's `RE…` SID for the recording. It is NOT stored on the Call row — the
   * recording-status webhook that enqueues this job is the only place it exists —
   * so it rides on the payload rather than being read back from the database.
   */
  recordingSid: string
}

/**
 * Where pg-boss is in its retry budget for this run.
 *
 * Passed in rather than read from a queue handle so the handler stays a plain
 * function a test can call directly, exactly as provisionNumber.ts does.
 */
export interface UploadRecordingAttempt {
  /** Retries already spent. 0 on the first run. */
  retryCount: number
  /** The ceiling from the queue/send options. */
  retryLimit: number
}

/** One retry, then the row is marked failed. Mirrors the queue default. */
export const UPLOAD_RECORDING_RETRY_LIMIT = 1

/** Seconds pg-boss waits before the retry — long enough for a Twilio/S3 blip to pass. */
export const UPLOAD_RECORDING_RETRY_DELAY_SECONDS = 30

/**
 * The S3 object key a call's recording is stored under.
 *
 * Derived purely from ids, so it is the same on every run for the same call —
 * which is what makes a retry overwrite the one object instead of leaving a
 * trail of copies. This is the bare key written onto `Call.recordingUrl`; the
 * GET-one route presigns it at request time (see routes/calls.ts).
 */
export function recordingObjectKey(orgId: string, callId: string): string {
  return `maincar-call-recordings/${orgId}/${callId}.mp3`
}

/**
 * Should this failure be retried?
 *
 *   - No HTTP status at all — a dropped socket, a timeout, an S3 client error
 *     with no Twilio status on it. Transient.
 *   - 429 — Twilio throttled us. Transient.
 *   - 5xx — Twilio's (or S3's) own side broke. Transient.
 *   - Any other 4xx from Twilio — the recording SID is wrong, or the recording is
 *     already gone (404). A retry replays the identical request for the identical
 *     answer. PERMANENT.
 *
 * Same split as provisionNumber.ts, and deliberately so: a job that cannot tell
 * transient from permanent either retries forever or gives up on a blip.
 */
function isTransientFailure(status: number | null): boolean {
  if (status === null) return true
  return status === 429 || status >= 500
}

/**
 * Mark the recording upload failed.
 *
 * `updateMany` with orgId, never `update({ where: { id } })` — the org filter is
 * defence in depth even here, where the id came off a row this process just read.
 * `recordingStatus: { not: 'stored' }` makes it a compare-and-set: if the upload
 * had in fact succeeded on another delivery, this writes nothing rather than
 * dragging a stored recording back to failed. Note this touches ONLY
 * `recordingStatus` — the call's own lifecycle `status` (completed, busy, …) is a
 * different fact and is never overwritten by a recording problem.
 */
async function markRecordingFailed(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, recordingStatus: { not: 'stored' } },
    data: { recordingStatus: 'failed' },
  })
}

/**
 * Fetch one call's recording from Twilio, store it in S3, and drop Twilio's copy.
 *
 * Exported as a plain function, with no pg-boss types in its signature, so the
 * whole decision tree is unit-testable without a queue.
 *
 * Contract with the queue:
 *   - returns normally  → the job is settled, do not retry
 *   - throws            → pg-boss retries, up to `attempt.retryLimit`
 */
export async function uploadRecordingJob(
  payload: UploadRecordingPayload,
  attempt: UploadRecordingAttempt = {
    retryCount: 0,
    retryLimit: UPLOAD_RECORDING_RETRY_LIMIT,
  },
): Promise<void> {
  const { callId, recordingSid } = payload

  // --- Load the row ---
  //
  // By id alone: a job has no caller and no token to take an orgId from. The id is
  // not user input — it came from a row this server wrote — and the orgId read
  // back here is what every write below is scoped to.
  const row = await prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, recordingUrl: true, recordingStatus: true },
  })

  if (!row) {
    // The call was deleted between enqueue and pickup. Nothing to store.
    logger.warn({ callId }, 'upload recording: call row is gone, nothing to store')
    return
  }

  // --- Idempotency guard ---
  //
  // pg-boss is at-least-once. A worker that already uploaded this recording and
  // then died leaves the job to be delivered again. `recordingUrl` set (and the
  // matching `recordingStatus: "stored"`) is the proof the work is done, and a
  // re-fetch would hit a recording we have since deleted from Twilio (a 404).
  if (row.recordingStatus === 'stored' || row.recordingUrl) {
    logger.info(
      { callId, orgId: row.orgId },
      'upload recording: recording already stored, skipping',
    )
    return
  }

  const objectKey = recordingObjectKey(row.orgId, callId)

  // --- Fetch from Twilio and put in S3 ---
  //
  // Both live in the same try because they are the one indivisible unit of work:
  // there is no value in a fetched buffer we failed to store, and nothing below
  // writes `recordingUrl` until the object is actually in the bucket.
  try {
    const media = await fetchRecordingMp3(recordingSid)
    await putRecording(objectKey, media.data, media.contentType)
  } catch (error) {
    const status = twilioErrorStatus(error)
    const retryable = isTransientFailure(status) && attempt.retryCount < attempt.retryLimit

    if (retryable) {
      // Leave the row untouched and rethrow: pg-boss owns the retry, and the
      // idempotency guard above still holds if this attempt had in fact stored it.
      logger.warn(
        { callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
        'upload recording: transient failure, handing it back to the queue',
      )
      throw error
    }

    // Permanent, or transient with the retry budget spent. Either way this
    // recording is not coming down. Note what is NOT logged: no auth token.
    logger.error(
      { callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
      'upload recording: could not fetch or store the recording',
    )
    await markRecordingFailed(callId, row.orgId)
    return
  }

  // --- Record it ---
  //
  // `recordingUrl` (the object key) and `recordingStatus` are written together,
  // only now that the object is really in S3. `recordingStatus: { not: 'stored' }`
  // in the filter so a duplicate delivery that slipped past the guard above still
  // cannot double-write.
  const updated = await prisma.call.updateMany({
    where: { id: callId, orgId: row.orgId, recordingStatus: { not: 'stored' } },
    data: { recordingUrl: objectKey, recordingStatus: 'stored' },
  })

  if (updated.count === 0) {
    // The upload went through but the row was deleted or already settled by
    // another delivery. The object is in S3 either way; leave it and move on.
    logger.warn(
      { callId, orgId: row.orgId },
      'upload recording: stored the object but the row was gone or already settled',
    )
    return
  }

  // --- Delete Twilio's copy (best effort) ---
  //
  // The recording is safely ours now, so a failure to delete Twilio's copy is a
  // small, non-fatal storage leak — not a reason to retry the whole job and risk
  // a redundant re-upload. Log it and let the job settle successfully.
  try {
    await deleteRecording(recordingSid)
  } catch (error) {
    logger.warn(
      { callId, orgId: row.orgId, error },
      'upload recording: stored the recording but could not delete it from Twilio',
    )
  }

  logger.info({ callId, orgId: row.orgId }, 'upload recording: stored')
}

/**
 * Enqueue an upload run for one call's recording.
 *
 * The recording-status webhook (a later issue) calls this once Twilio reports the
 * recording is complete, handing it the call id and the recording SID.
 */
export async function queueUploadRecording(
  callId: string,
  recordingSid: string,
): Promise<string | null> {
  const payload: UploadRecordingPayload = { callId, recordingSid }
  return sendJob(JOB_UPLOAD_RECORDING, payload, {
    retryLimit: UPLOAD_RECORDING_RETRY_LIMIT,
    retryDelay: UPLOAD_RECORDING_RETRY_DELAY_SECONDS,
  })
}

/**
 * Attach the worker. Called once, from index.ts — never from app.ts.
 *
 * `batchSize: 1` because each job downloads and stores its own file; there is
 * nothing to gain from fetching several at once and a partial batch failure would
 * be harder to reason about than a queue of singles.
 */
export async function registerUploadRecordingWorker(): Promise<string> {
  return workJob<UploadRecordingPayload>(JOB_UPLOAD_RECORDING, { batchSize: 1 }, async (job) => {
    await uploadRecordingJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
