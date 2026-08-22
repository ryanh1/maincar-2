import { getAudioDurationSeconds, transcodeWebmToMp3 } from '../../dependencies/ffmpeg.js'
import { logger } from '../../dependencies/logger.js'
import { deleteObject, getObjectBytes, putObjectBytes } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCODE_GREETING, sendJob, workJob } from './queue.js'

export interface TranscodeGreetingPayload {
  orgId: string
  greetingId: string
}

export interface TranscodeGreetingAttempt {
  retryCount: number
  retryLimit: number
}

export const TRANSCODE_GREETING_RETRY_LIMIT = 1
export const TRANSCODE_GREETING_RETRY_DELAY_SECONDS = 30
export const MAX_GREETING_DURATION_SECONDS = 120

class GreetingValidationError extends Error {}

export function greetingObjectKey(orgId: string, greetingId: string): string {
  return `maincar-voicemail-greetings/${orgId}/${greetingId}.mp3`
}

async function markGreetingFailed(
  orgId: string,
  greetingId: string,
  failureReason: string,
): Promise<void> {
  await prisma.voicemailGreeting.updateMany({
    where: { id: greetingId, orgId, status: 'transcoding' },
    data: { status: 'failed', failureReason },
  })
}

/**
 * Convert one immutable uploaded candidate into an immutable MP3. pg-boss is
 * at-least-once, so only a transcoding candidate can settle to ready; activation
 * remains an explicit authorized route action.
 */
export async function transcodeGreetingJob(
  payload: TranscodeGreetingPayload,
  attempt: TranscodeGreetingAttempt = {
    retryCount: 0,
    retryLimit: TRANSCODE_GREETING_RETRY_LIMIT,
  },
): Promise<void> {
  const { orgId, greetingId } = payload
  const greeting = await prisma.voicemailGreeting.findFirst({
    where: { id: greetingId, orgId },
    select: { id: true, orgId: true, sourceKey: true, storageKey: true, status: true },
  })

  if (!greeting) {
    logger.warn({ orgId }, 'transcode greeting: greeting row is gone, nothing to process')
    return
  }

  if (greeting.status !== 'transcoding' || !greeting.sourceKey) {
    logger.info({ orgId, status: greeting.status }, 'transcode greeting: already settled, skipping')
    return
  }

  const outputKey = greetingObjectKey(orgId, greeting.id)

  try {
    const webm = await getObjectBytes(greeting.sourceKey)
    const mp3 = await transcodeWebmToMp3(webm)
    const durationSeconds = Math.ceil(await getAudioDurationSeconds(mp3))
    if (durationSeconds > MAX_GREETING_DURATION_SECONDS) {
      throw new GreetingValidationError(
        `Greeting is longer than ${MAX_GREETING_DURATION_SECONDS} seconds. Upload a shorter candidate.`,
      )
    }
    await putObjectBytes({ key: outputKey, body: mp3, contentType: 'audio/mpeg' })
    await deleteObject(greeting.sourceKey)

    const updated = await prisma.voicemailGreeting.updateMany({
      where: { id: greeting.id, orgId, status: 'transcoding' },
      data: {
        storageKey: outputKey,
        status: 'ready',
        durationSeconds,
        uploadedAt: new Date(),
        failureReason: null,
      },
    })

    if (updated.count === 0) {
      logger.warn({ orgId }, 'transcode greeting: converted but greeting was already settled')
      await deleteObject(outputKey)
      return
    }
  } catch (error) {
    if (!(error instanceof GreetingValidationError) && attempt.retryCount < attempt.retryLimit) {
      logger.warn(
        { orgId, retryCount: attempt.retryCount, error },
        'transcode greeting: failure, handing it back to the queue',
      )
      throw error
    }

    await markGreetingFailed(
      orgId,
      greeting.id,
      error instanceof GreetingValidationError
        ? error.message
        : 'Audio conversion failed. Upload a new candidate.',
    )
    try {
      await Promise.all([deleteObject(greeting.sourceKey), deleteObject(outputKey)])
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
