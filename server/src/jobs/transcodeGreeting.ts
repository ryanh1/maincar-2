import { transcodeWebmToMp3 } from '../../dependencies/ffmpeg.js'
import { logger } from '../../dependencies/logger.js'
import { deleteObject, getObjectBytes, putObjectBytes } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCODE_GREETING, sendJob, workJob } from './queue.js'

export interface TranscodeGreetingPayload {
  orgId: string
  tempObjectKey: string
}

export interface TranscodeGreetingAttempt {
  retryCount: number
  retryLimit: number
}

export const TRANSCODE_GREETING_RETRY_LIMIT = 1
export const TRANSCODE_GREETING_RETRY_DELAY_SECONDS = 30

export function greetingObjectKey(orgId: string): string {
  return `maincar-voicemail-greetings/${orgId}/greeting.mp3`
}

async function markGreetingFailed(orgId: string): Promise<void> {
  await prisma.voicemailGreeting.updateMany({
    where: { orgId, status: 'pending' },
    data: { status: 'failed' },
  })
}

/**
 * Convert one queued temporary greeting into the stable MP3 the inbound TwiML
 * route plays. pg-boss is at-least-once, so completed or failed rows are never
 * reprocessed and the database update is a status compare-and-set.
 */
export async function transcodeGreetingJob(
  payload: TranscodeGreetingPayload,
  attempt: TranscodeGreetingAttempt = {
    retryCount: 0,
    retryLimit: TRANSCODE_GREETING_RETRY_LIMIT,
  },
): Promise<void> {
  const { orgId, tempObjectKey } = payload
  const greeting = await prisma.voicemailGreeting.findUnique({
    where: { orgId },
    select: { id: true, orgId: true, audioUrl: true, status: true },
  })

  if (!greeting) {
    logger.warn({ orgId }, 'transcode greeting: greeting row is gone, nothing to process')
    return
  }

  if (greeting.status !== 'pending') {
    logger.info({ orgId, status: greeting.status }, 'transcode greeting: already settled, skipping')
    return
  }

  const outputKey = greetingObjectKey(orgId)

  try {
    const webm = await getObjectBytes(tempObjectKey)
    const mp3 = await transcodeWebmToMp3(webm)
    await putObjectBytes({ key: outputKey, body: mp3, contentType: 'audio/mpeg' })
    await deleteObject(tempObjectKey)
  } catch (error) {
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { orgId, retryCount: attempt.retryCount, error },
        'transcode greeting: failure, handing it back to the queue',
      )
      throw error
    }

    await markGreetingFailed(orgId)
    try {
      await deleteObject(tempObjectKey)
    } catch (cleanupError) {
      logger.warn(
        { orgId, cleanupError },
        'transcode greeting: failed to delete temporary object after giving up',
      )
    }
    logger.error(
      { orgId, retryCount: attempt.retryCount, error },
      'transcode greeting: could not convert the greeting',
    )
    return
  }

  const updated = await prisma.voicemailGreeting.updateMany({
    where: { orgId, status: 'pending' },
    data: { audioUrl: outputKey, status: 'ready', uploadedAt: new Date() },
  })

  if (updated.count === 0) {
    logger.warn({ orgId }, 'transcode greeting: converted but greeting was already settled')
    return
  }

  logger.info({ orgId }, 'transcode greeting: stored MP3')
}

export async function queueTranscodeGreeting(payload: TranscodeGreetingPayload): Promise<string | null> {
  return sendJob(JOB_TRANSCODE_GREETING, payload, {
    retryLimit: TRANSCODE_GREETING_RETRY_LIMIT,
    retryDelay: TRANSCODE_GREETING_RETRY_DELAY_SECONDS,
  })
}

export async function registerTranscodeGreetingWorker(): Promise<string> {
  return workJob<TranscodeGreetingPayload>(JOB_TRANSCODE_GREETING, { batchSize: 1 }, async (job) => {
    await transcodeGreetingJob(job.data, {
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
    })
  })
}
