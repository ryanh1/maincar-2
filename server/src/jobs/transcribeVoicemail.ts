import { transcribeRecording as transcribeAudio, openaiErrorStatus } from '../../dependencies/openai.js'
import { logger } from '../../dependencies/logger.js'
import { getRecordingDownloadUrl } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCRIBE_VOICEMAIL, sendJob, workJob } from './queue.js'

export interface TranscribeVoicemailPayload {
  voicemailId: string
}

export interface TranscribeVoicemailAttempt {
  retryCount: number
  retryLimit: number
}

export const TRANSCRIBE_VOICEMAIL_RETRY_LIMIT = 1
export const TRANSCRIBE_VOICEMAIL_RETRY_DELAY_SECONDS = 30

async function markTranscriptFailed(voicemailId: string, orgId: string): Promise<void> {
  await prisma.voicemail.updateMany({
    where: { id: voicemailId, orgId, transcriptStatus: { not: 'done' } },
    data: { transcriptStatus: 'failed' },
  })
}

/**
 * Transcribe an inbound voicemail after its upload job has stored the recording
 * in S3. It is safe under pg-boss's at-least-once delivery: a completed
 * transcript is never sent to Whisper again, and writes are compare-and-set.
 */
export async function transcribeVoicemailJob(
  payload: TranscribeVoicemailPayload,
  attempt: TranscribeVoicemailAttempt = {
    retryCount: 0,
    retryLimit: TRANSCRIBE_VOICEMAIL_RETRY_LIMIT,
  },
): Promise<void> {
  const { voicemailId } = payload

  // The job originates from a server-created voicemail row. Read its orgId so
  // every write remains tenant-scoped even though background work has no token.
  const row = await prisma.voicemail.findUnique({
    where: { id: voicemailId },
    select: { id: true, orgId: true, recordingUrl: true, transcriptStatus: true },
  })

  if (!row) {
    logger.warn({ voicemailId }, 'transcribe voicemail: voicemail row is gone, nothing to transcribe')
    return
  }

  if (row.transcriptStatus === 'done') {
    logger.info({ voicemailId, orgId: row.orgId }, 'transcribe voicemail: already transcribed, skipping')
    return
  }

  // This should be unreachable because uploadVoicemail queues us only after its
  // compare-and-set storage write, but settling it avoids a permanently pending
  // row if a manually inserted or stale job arrives without a recording.
  if (!row.recordingUrl) {
    logger.error({ voicemailId, orgId: row.orgId }, 'transcribe voicemail: recording is missing')
    await markTranscriptFailed(voicemailId, row.orgId)
    return
  }

  let transcript: string
  try {
    const audioUrl = await getRecordingDownloadUrl(row.recordingUrl)
    transcript = await transcribeAudio(audioUrl)
  } catch (error) {
    const status = openaiErrorStatus(error)
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { voicemailId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
        'transcribe voicemail: failure, handing it back to the queue',
      )
      throw error
    }

    logger.error(
      { voicemailId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
      'transcribe voicemail: could not transcribe the recording, giving up',
    )
    await markTranscriptFailed(voicemailId, row.orgId)
    return
  }

  const updated = await prisma.voicemail.updateMany({
    where: { id: voicemailId, orgId: row.orgId, transcriptStatus: { not: 'done' } },
    data: { transcript, transcriptStatus: 'done' },
  })

  if (updated.count === 0) {
    logger.warn(
      { voicemailId, orgId: row.orgId },
      'transcribe voicemail: transcribed but the row was gone or already settled',
    )
    return
  }

  logger.info({ voicemailId, orgId: row.orgId }, 'transcribe voicemail: transcribed')
}

export async function queueTranscribeVoicemail(voicemailId: string): Promise<string | null> {
  return sendJob(JOB_TRANSCRIBE_VOICEMAIL, { voicemailId }, {
    retryLimit: TRANSCRIBE_VOICEMAIL_RETRY_LIMIT,
    retryDelay: TRANSCRIBE_VOICEMAIL_RETRY_DELAY_SECONDS,
  })
}

export async function registerTranscribeVoicemailWorker(): Promise<string> {
  return workJob<TranscribeVoicemailPayload>(JOB_TRANSCRIBE_VOICEMAIL, { batchSize: 1 }, async (job) => {
    await transcribeVoicemailJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
