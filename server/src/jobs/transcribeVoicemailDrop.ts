import { transcribeRecording as transcribeAudio, openaiErrorStatus } from '../../dependencies/openai.js'
import { logger } from '../../dependencies/logger.js'
import { getRecordingDownloadUrl } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCRIBE_VOICEMAIL_DROP, sendJob, workJob } from './queue.js'

export interface TranscribeVoicemailDropPayload {
  voicemailDropId: string
}

export interface TranscribeVoicemailDropAttempt {
  retryCount: number
  retryLimit: number
}

export const TRANSCRIBE_VOICEMAIL_DROP_RETRY_LIMIT = 1
export const TRANSCRIBE_VOICEMAIL_DROP_RETRY_DELAY_SECONDS = 30

async function markTranscriptFailed(voicemailDropId: string, orgId: string): Promise<void> {
  await prisma.voicemailDrop.updateMany({
    where: { id: voicemailDropId, orgId, transcriptStatus: { not: 'done' } },
    data: { transcriptStatus: 'failed' },
  })
}

/**
 * Transcribe a library voicemail drop after its audio is stored in S3. The job
 * is safe under pg-boss's at-least-once delivery: a completed drop is never
 * sent to Whisper again, and writes are tenant-scoped compare-and-set updates.
 */
export async function transcribeVoicemailDropJob(
  payload: TranscribeVoicemailDropPayload,
  attempt: TranscribeVoicemailDropAttempt = {
    retryCount: 0,
    retryLimit: TRANSCRIBE_VOICEMAIL_DROP_RETRY_LIMIT,
  },
): Promise<void> {
  const { voicemailDropId } = payload
  const row = await prisma.voicemailDrop.findUnique({
    where: { id: voicemailDropId },
    select: { id: true, orgId: true, audioUrl: true, transcriptStatus: true },
  })

  if (!row) {
    logger.warn({ voicemailDropId }, 'transcribe voicemail drop: row is gone, nothing to transcribe')
    return
  }

  if (row.transcriptStatus === 'done') {
    logger.info(
      { voicemailDropId, orgId: row.orgId },
      'transcribe voicemail drop: already transcribed, skipping',
    )
    return
  }

  let transcript: string
  try {
    const audioUrl = await getRecordingDownloadUrl(row.audioUrl)
    transcript = await transcribeAudio(audioUrl)
  } catch (error) {
    const status = openaiErrorStatus(error)
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { voicemailDropId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
        'transcribe voicemail drop: failure, handing it back to the queue',
      )
      throw error
    }

    logger.error(
      { voicemailDropId, orgId: row.orgId, status, retryCount: attempt.retryCount, error },
      'transcribe voicemail drop: could not transcribe the audio, giving up',
    )
    await markTranscriptFailed(voicemailDropId, row.orgId)
    return
  }

  const updated = await prisma.voicemailDrop.updateMany({
    where: { id: voicemailDropId, orgId: row.orgId, transcriptStatus: { not: 'done' } },
    data: { transcript, transcriptStatus: 'done' },
  })

  if (updated.count === 0) {
    logger.warn(
      { voicemailDropId, orgId: row.orgId },
      'transcribe voicemail drop: transcribed but the row was gone or already settled',
    )
    return
  }

  logger.info({ voicemailDropId, orgId: row.orgId }, 'transcribe voicemail drop: transcribed')
}

export async function queueTranscribeVoicemailDrop(voicemailDropId: string): Promise<string | null> {
  return sendJob(JOB_TRANSCRIBE_VOICEMAIL_DROP, { voicemailDropId }, {
    retryLimit: TRANSCRIBE_VOICEMAIL_DROP_RETRY_LIMIT,
    retryDelay: TRANSCRIBE_VOICEMAIL_DROP_RETRY_DELAY_SECONDS,
  })
}

export async function registerTranscribeVoicemailDropWorker(): Promise<string> {
  return workJob<TranscribeVoicemailDropPayload>(
    JOB_TRANSCRIBE_VOICEMAIL_DROP,
    { batchSize: 1 },
    async (job) => {
      await transcribeVoicemailDropJob(job.data, {
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
      })
    },
  )
}
