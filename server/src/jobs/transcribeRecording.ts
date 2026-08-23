import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

import { deepgramErrorStatus, transcribeCallRecording, type DeepgramTranscript } from '../../dependencies/deepgram.js'
import { logger } from '../../dependencies/logger.js'
import { getObjectBytes, RECORDING_CONTENT_TYPE } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { JOB_TRANSCRIBE_RECORDING, sendJob, workJob } from './queue.js'
import { transcriptionDiagnostic, type TranscriptLifecycleState, type TranscriptionStage } from './transcriptionLifecycle.js'

export interface TranscribeRecordingPayload { callId: string }
export interface TranscribeRecordingAttempt { retryCount: number; retryLimit: number }
export const TRANSCRIBE_RECORDING_RETRY_LIMIT = 1
export const TRANSCRIBE_RECORDING_RETRY_DELAY_SECONDS = 30

function terminalTranscriptData(state: Extract<TranscriptLifecycleState, 'done' | 'failed' | 'skipped-not-recorded'>, transcript?: string) {
  return state === 'done' ? { transcript: transcript ?? '', transcriptStatus: state } : { transcriptStatus: state }
}

async function markTranscriptFailed(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, transcriptStatus: { not: 'done' } }, data: terminalTranscriptData('failed'),
  })
}

async function markTranscriptSkipped(callId: string, orgId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId, orgId, transcriptStatus: { not: 'done' } }, data: terminalTranscriptData('skipped-not-recorded'),
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
      data: terminalTranscriptData('done', result.plainText),
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
    logger.info({ diagnostic: transcriptionDiagnostic({ callId, orgId: row.orgId, retryCount: attempt.retryCount, retryLimit: attempt.retryLimit, recordingAvailable: false, providerOutcome: 'not-called', stage: 'recording', transcriptState: 'skipped-not-recorded' }) }, 'transcribe recording: policy unavailable or recording missing, marked skipped-not-recorded')
    return
  }

  let stage: TranscriptionStage = 'recording'
  try {
    const audio = await getObjectBytes(row.recordingUrl)
    stage = 'provider'
    const result = await transcribeCallRecording(audio, RECORDING_CONTENT_TYPE)
    stage = 'persistence'
    if (!await persistFinalTranscript(prisma, callId, row.orgId, result)) {
      logger.warn({ callId, orgId: row.orgId }, 'transcribe recording: transcribed but the row was already settled')
      return
    }
  } catch (error) {
    const status = stage === 'provider' ? deepgramErrorStatus(error) : null
    const diagnostic = transcriptionDiagnostic({
      callId, orgId: row.orgId, retryCount: attempt.retryCount, retryLimit: attempt.retryLimit, recordingAvailable: true,
      providerOutcome: stage === 'recording' ? 'not-called' : stage === 'provider' ? 'failed' : 'succeeded', providerStatus: status,
      stage, transcriptState: attempt.retryCount < attempt.retryLimit ? 'pending' : 'failed',
    })
    if (attempt.retryCount < attempt.retryLimit) {
      logger.warn({ diagnostic }, 'transcribe recording: failure, handing it back to the queue')
      throw error
    }
    await markTranscriptFailed(callId, row.orgId)
    logger.error({ diagnostic }, 'transcribe recording: could not transcribe the recording, giving up')
    return
  }

  logger.info({ diagnostic: transcriptionDiagnostic({ callId, orgId: row.orgId, retryCount: attempt.retryCount, retryLimit: attempt.retryLimit, recordingAvailable: true, providerOutcome: 'succeeded', stage: 'persistence', transcriptState: 'done' }) }, 'transcribe recording: Deepgram final pass stored')
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
