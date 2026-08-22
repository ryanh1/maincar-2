import { getAudioDurationSeconds, transcodeWebmToMp3 } from '../../dependencies/ffmpeg.js'
import { logger } from '../../dependencies/logger.js'
import { deleteObject, getObjectBytes, putObjectBytes } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCODE_VOICEMAIL_DROP, sendJob, workJob } from './queue.js'

export interface TranscodeVoicemailDropPayload {
  orgId: string
  voicemailDropId: string
}

export interface TranscodeVoicemailDropAttempt {
  retryCount: number
  retryLimit: number
}

export const TRANSCODE_VOICEMAIL_DROP_RETRY_LIMIT = 1
export const TRANSCODE_VOICEMAIL_DROP_RETRY_DELAY_SECONDS = 30

export function voicemailDropObjectKey(orgId: string, voicemailDropId: string): string {
  return `maincar-voicemail-drops/${orgId}/${voicemailDropId}.mp3`
}

async function markTranscriptionFailed(orgId: string, voicemailDropId: string): Promise<void> {
  // The current drop model has no separate transcode status. Do not overwrite a
  // transcript that completed while this job was retrying.
  await prisma.voicemailDrop.updateMany({
    where: { id: voicemailDropId, orgId, transcriptStatus: { not: 'done' } },
    data: { transcriptStatus: 'failed' },
  })
}

/**
 * Convert a voicemail drop's temporary WebM into the stable, private MP3 the
 * rest of the voicemail library reads. The audio key compare-and-set makes an
 * at-least-once pg-boss delivery idempotent once conversion has settled.
 */
export async function transcodeVoicemailDropJob(
  payload: TranscodeVoicemailDropPayload,
  attempt: TranscodeVoicemailDropAttempt = {
    retryCount: 0,
    retryLimit: TRANSCODE_VOICEMAIL_DROP_RETRY_LIMIT,
  },
): Promise<void> {
  const { orgId, voicemailDropId } = payload
  const drop = await prisma.voicemailDrop.findFirst({
    where: { id: voicemailDropId, orgId },
    select: { id: true, orgId: true, audioUrl: true },
  })

  if (!drop) {
    logger.warn({ orgId, voicemailDropId }, 'transcode voicemail drop: row is gone, nothing to process')
    return
  }

  if (!drop.audioUrl.endsWith('.webm')) {
    logger.info({ orgId, voicemailDropId }, 'transcode voicemail drop: already settled, skipping')
    return
  }

  const sourceKey = drop.audioUrl
  const outputKey = voicemailDropObjectKey(orgId, voicemailDropId)

  try {
    const webm = await getObjectBytes(sourceKey)
    const mp3 = await transcodeWebmToMp3(webm)
    const duration = Math.ceil(await getAudioDurationSeconds(mp3))

    await putObjectBytes({ key: outputKey, body: mp3, contentType: 'audio/mpeg' })
    await deleteObject(sourceKey)

    const updated = await prisma.voicemailDrop.updateMany({
      where: { id: voicemailDropId, orgId, audioUrl: sourceKey },
      data: { audioUrl: outputKey, duration },
    })

    if (updated.count === 0) {
      logger.warn(
        { orgId, voicemailDropId },
        'transcode voicemail drop: converted but the drop was already settled',
      )
      await deleteObject(outputKey)
      return
    }
  } catch (error) {
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { orgId, voicemailDropId, retryCount: attempt.retryCount, error },
        'transcode voicemail drop: failure, handing it back to the queue',
      )
      throw error
    }

    await markTranscriptionFailed(orgId, voicemailDropId)
    try {
      await Promise.all([deleteObject(sourceKey), deleteObject(outputKey)])
    } catch (cleanupError) {
      logger.warn(
        { orgId, voicemailDropId, cleanupError },
        'transcode voicemail drop: failed to delete temporary object after giving up',
      )
    }
    logger.error(
      { orgId, voicemailDropId, retryCount: attempt.retryCount, error },
      'transcode voicemail drop: could not convert the drop',
    )
    return
  }

  logger.info({ orgId, voicemailDropId }, 'transcode voicemail drop: stored MP3')
}

export async function queueTranscodeVoicemailDrop(
  payload: TranscodeVoicemailDropPayload,
): Promise<string | null> {
  return sendJob(JOB_TRANSCODE_VOICEMAIL_DROP, payload, {
    retryLimit: TRANSCODE_VOICEMAIL_DROP_RETRY_LIMIT,
    retryDelay: TRANSCODE_VOICEMAIL_DROP_RETRY_DELAY_SECONDS,
  })
}

export async function registerTranscodeVoicemailDropWorker(): Promise<string> {
  return workJob<TranscodeVoicemailDropPayload>(
    JOB_TRANSCODE_VOICEMAIL_DROP,
    { batchSize: 1 },
    async (job) => {
      await transcodeVoicemailDropJob(job.data, {
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
      })
    },
  )
}
