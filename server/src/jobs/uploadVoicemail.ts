import { deleteRecording, fetchRecordingMp3, twilioErrorStatus } from '../../dependencies/twilio.js'
import { putRecording } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { JOB_UPLOAD_VOICEMAIL, sendJob, workJob } from './queue.js'

// The job that turns a finished inbound voicemail recording into an object we
// own: fetch the MP3 from Twilio, put it in S3 under a stable key, point the
// Voicemail row at that key, and delete Twilio's copy. The outbound twin of
// jobs/uploadRecording.ts — same shape, same at-least-once safety, a different
// row and a different S3 prefix.

/** Everything the job needs. The Voicemail row supplies orgId; Twilio supplies the media. */
export interface UploadVoicemailPayload {
  /** The Voicemail row this recording belongs to. */
  voicemailId: string
  /**
   * Twilio's `RE…` SID for the recording. Not stored on the Voicemail row — the
   * recording-status webhook that enqueues this job is the only place it exists —
   * so it rides on the payload rather than being read back from the database.
   */
  recordingSid: string
}

/** Where pg-boss is in its retry budget for this run. Mirrors uploadRecording.ts. */
export interface UploadVoicemailAttempt {
  /** Retries already spent. 0 on the first run. */
  retryCount: number
  /** The ceiling from the queue/send options. */
  retryLimit: number
}

/** One retry, then the row is left unstored. Mirrors the queue default. */
export const UPLOAD_VOICEMAIL_RETRY_LIMIT = 1

/** Seconds pg-boss waits before the retry — long enough for a Twilio/S3 blip to pass. */
export const UPLOAD_VOICEMAIL_RETRY_DELAY_SECONDS = 30

/**
 * The S3 object key a voicemail's recording is stored under, exactly the shape
 * the Voicemail.recordingUrl doc comment in schema.prisma promises.
 *
 * Derived purely from ids, so a retry overwrites the one object instead of
 * leaving a trail of copies.
 */
export function voicemailObjectKey(orgId: string, voicemailId: string): string {
  return `maincar-voicemail-drops/${orgId}/${voicemailId}.mp3`
}

/** Same transient/permanent split as jobs/uploadRecording.ts, for the same reason. */
function isTransientFailure(status: number | null): boolean {
  if (status === null) return true
  return status === 429 || status >= 500
}

/**
 * Fetch one voicemail's recording from Twilio, store it in S3, and drop Twilio's
 * copy.
 *
 * Contract with the queue:
 *   - returns normally  → the job is settled, do not retry
 *   - throws            → pg-boss retries, up to `attempt.retryLimit`
 */
export async function uploadVoicemailJob(
  payload: UploadVoicemailPayload,
  attempt: UploadVoicemailAttempt = {
    retryCount: 0,
    retryLimit: UPLOAD_VOICEMAIL_RETRY_LIMIT,
  },
): Promise<void> {
  const { voicemailId, recordingSid } = payload

  // --- Load the row ---
  //
  // By id alone: a job has no caller and no token to take an orgId from. The id
  // came off a row this server wrote, and the orgId read back here is what the
  // write below is scoped to.
  const row = await prisma.voicemail.findUnique({
    where: { id: voicemailId },
    select: { id: true, orgId: true, recordingUrl: true },
  })

  if (!row) {
    // The voicemail was deleted between enqueue and pickup. Nothing to store.
    logger.warn({ voicemailId }, 'upload voicemail: voicemail row is gone, nothing to store')
    return
  }

  // --- Idempotency guard ---
  //
  // pg-boss is at-least-once. A worker that already uploaded this recording and
  // then died leaves the job to be delivered again. `recordingUrl` set is the
  // proof the work is done, and a re-fetch would hit a recording we have since
  // deleted from Twilio (a 404).
  if (row.recordingUrl) {
    logger.info(
      { voicemailId, orgId: row.orgId },
      'upload voicemail: recording already stored, skipping',
    )
    return
  }

  const objectKey = voicemailObjectKey(row.orgId, voicemailId)

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
      logger.warn(
        { voicemailId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
        'upload voicemail: transient failure, handing it back to the queue',
      )
      throw error
    }

    // Permanent, or transient with the retry budget spent. The recording is not
    // coming down; leave recordingUrl null rather than guess at a value.
    logger.error(
      { voicemailId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
      'upload voicemail: could not fetch or store the recording',
    )
    return
  }

  // --- Record it ---
  //
  // `recordingUrl: null` in the filter makes this a compare-and-set: a duplicate
  // delivery that slipped past the guard above still cannot double-write.
  const updated = await prisma.voicemail.updateMany({
    where: { id: voicemailId, orgId: row.orgId, recordingUrl: null },
    data: { recordingUrl: objectKey },
  })

  if (updated.count === 0) {
    // The upload went through but the row was deleted or already settled by
    // another delivery. The object is in S3 either way; leave it and move on.
    logger.warn(
      { voicemailId, orgId: row.orgId },
      'upload voicemail: stored the object but the row was gone or already settled',
    )
    return
  }

  // --- Delete Twilio's copy (best effort) ---
  //
  // The recording is safely ours now, so a failure to delete Twilio's copy is a
  // small, non-fatal storage leak — not a reason to retry the whole job and risk
  // a redundant re-upload.
  try {
    await deleteRecording(recordingSid)
  } catch (error) {
    logger.warn(
      { voicemailId, orgId: row.orgId, error },
      'upload voicemail: stored the recording but could not delete it from Twilio',
    )
  }

  logger.info({ voicemailId, orgId: row.orgId }, 'upload voicemail: stored')
}

/**
 * Enqueue an upload run for one voicemail's recording.
 *
 * The inbound recording-status webhook (routes/twilioVoice.ts → POST
 * /voice/voicemail-recording) calls this when a completed recording is reported,
 * handing it the voicemail id and the recording SID.
 */
export async function queueUploadVoicemail(
  voicemailId: string,
  recordingSid: string,
): Promise<string | null> {
  const payload: UploadVoicemailPayload = { voicemailId, recordingSid }
  return sendJob(JOB_UPLOAD_VOICEMAIL, payload, {
    retryLimit: UPLOAD_VOICEMAIL_RETRY_LIMIT,
    retryDelay: UPLOAD_VOICEMAIL_RETRY_DELAY_SECONDS,
  })
}

/**
 * Attach the worker. Called once, from index.ts — never from app.ts.
 *
 * `batchSize: 1` because each job downloads and stores its own file; there is
 * nothing to gain from fetching several at once.
 */
export async function registerUploadVoicemailWorker(): Promise<string> {
  return workJob<UploadVoicemailPayload>(JOB_UPLOAD_VOICEMAIL, { batchSize: 1 }, async (job) => {
    await uploadVoicemailJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
