import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

import { deepgramErrorStatus, transcribeCallRecording, type DeepgramTranscript } from '../../dependencies/deepgram.js'
import { logger } from '../../dependencies/logger.js'
import { getObjectBytes, RECORDING_CONTENT_TYPE } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCRIBE_RECORDING, sendJob, workJob } from './queue.js'

export interface TranscribeRecordingPayload { callId: string }
export interface TranscribeRecordingAttempt { retryCount: number; retryLimit: number }
export const TRANSCRIBE_RECORDING_RETRY_LIMIT = 1
export const TRANSCRIBE_RECORDING_RETRY_DELAY_SECONDS = 30

async function markTranscriptFailed(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, transcriptStatus: { not: 'done' } }, data: { transcriptStatus: 'failed' },
  })
}

async function markTranscriptSkipped(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, transcriptStatus: { not: 'done' } }, data: { transcriptStatus: 'skipped-not-recorded' },
  })
}

function transcriptSegments(orgId: string, result: DeepgramTranscript) {
  return result.segments.map((segment, position) => ({
    orgId, position, speakerKey: segment.speakerKey, startMs: segment.startMs, endMs: segment.endMs,
    text: segment.text, words: segment.words as unknown as Prisma.InputJsonValue,
  }))
}

/**
 * Write a completed provider pass as one transaction. Transcript segments belong
 * to the provider and are replaced as a set; CallSpeaker is intentionally never
 * touched, so manual identity corrections survive every final pass.
 */
export async function persistFinalTranscript(
  client: Pick<PrismaClient, '$transaction'>,
  callId: string,
  orgId: string,
  result: DeepgramTranscript,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const updated = await tx.call.updateMany({
      where: { id: callId, orgId, recordingPlanned: true, transcriptStatus: { not: 'done' } },
      data: { transcript: result.plainText, transcriptStatus: 'done' },
    })
    if (updated.count === 0) return false

    const segments = transcriptSegments(orgId, result)
    await tx.transcript.upsert({
      where: { callId },
      create: { orgId, callId, provider: 'deepgram', plainText: result.plainText, segments: { create: segments } },
      update: {
        provider: 'deepgram', plainText: result.plainText,
        segments: { deleteMany: {}, create: segments },
      },
    })
    return true
  })
}

/**
 * Final-pass a policy-eligible stored recording. The server reads object bytes;
 * Deepgram never receives a development-only presigned URL.
 */
export async function transcribeRecordingJob(
  { callId }: TranscribeRecordingPayload,
  attempt: TranscribeRecordingAttempt = { retryCount: 0, retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT },
): Promise<void> {
  const row = await prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, recordingUrl: true, recordingPlanned: true, transcriptStatus: true },
  })
  if (!row) {
    logger.warn({ callId }, 'transcribe recording: call row is gone, nothing to transcribe')
    return
  }
  if (row.transcriptStatus === 'done') {
    logger.info({ callId, orgId: row.orgId }, 'transcribe recording: already transcribed, skipping')
    return
  }
  if (row.recordingPlanned !== true || !row.recordingUrl) {
    await markTranscriptSkipped(callId, row.orgId)
    logger.info({ callId, orgId: row.orgId }, 'transcribe recording: policy unavailable or recording missing, marked skipped-not-recorded')
    return
  }

  let result: DeepgramTranscript
  try {
    const audio = await getObjectBytes(row.recordingUrl)
    result = await transcribeCallRecording(audio, RECORDING_CONTENT_TYPE)
  } catch (error) {
    const status = deepgramErrorStatus(error)
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn({ callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error }, 'transcribe recording: failure, handing it back to the queue')
      throw error
    }
    logger.error({ callId, orgId: row.orgId, status, retryCount: attempt.retryCount, error }, 'transcribe recording: could not transcribe the recording, giving up')
    await markTranscriptFailed(callId, row.orgId)
    return
  }

  if (!await persistFinalTranscript(prisma, callId, row.orgId, result)) {
    logger.warn({ callId, orgId: row.orgId }, 'transcribe recording: transcribed but the row was already settled')
    return
  }
  logger.info({ callId, orgId: row.orgId }, 'transcribe recording: Deepgram final pass stored')
}

export function queueTranscribeRecording(callId: string): Promise<string | null> {
  return sendJob(JOB_TRANSCRIBE_RECORDING, { callId }, {
    retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT, retryDelay: TRANSCRIBE_RECORDING_RETRY_DELAY_SECONDS,
  })
}

export function registerTranscribeRecordingWorker(): Promise<string> {
  return workJob<TranscribeRecordingPayload>(JOB_TRANSCRIBE_RECORDING, { batchSize: 1 }, async (job) => {
    await transcribeRecordingJob(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit })
  })
}
