import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../dependencies/logger.js'

vi.mock('../../config.js', () => ({ DEEPGRAM_API_KEY: 'dg-test-key' }))

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
  speakerFindMany: vi.fn(),
  speakerCreate: vi.fn(),
  speakerUpdateMany: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('../../db.js', () => ({ default: { call: { findUnique: db.findUnique, updateMany: db.updateMany }, $transaction: db.transaction } }))

const s3 = vi.hoisted(() => ({ getObjectBytes: vi.fn() }))
vi.mock('../../../dependencies/s3.js', () => ({ getObjectBytes: s3.getObjectBytes, RECORDING_CONTENT_TYPE: 'audio/mpeg' }))

const deepgram = vi.hoisted(() => ({ transcribeCallRecording: vi.fn() }))
vi.mock('../../../dependencies/deepgram.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dependencies/deepgram.js')>()), transcribeCallRecording: deepgram.transcribeCallRecording,
}))
vi.mock('../../../dependencies/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))
vi.mock('../queue.js', () => ({ JOB_TRANSCRIBE_RECORDING: 'transcribe-recording', sendJob: queue.sendJob, workJob: queue.workJob }))

import { queueTranscribeRecording, registerTranscribeRecordingWorker, TRANSCRIBE_RECORDING_RETRY_LIMIT, transcribeRecordingJob } from '../transcribeRecording.js'

const ROW = { id: 'call_1', orgId: 'org_1', recordingUrl: 'maincar-call-recordings/org_1/call_1.mp3' as string | null, recordingPlanned: true, transcriptStatus: 'pending' }
const RESULT = {
  plainText: 'Hello there.\nHola.',
  segments: [{ channel: 0, speaker: 1, speakerKey: 'deepgram:channel:0:speaker:1', startMs: 200, endMs: 900, confidence: 0.98, language: 'en', text: 'Hello there.', words: [{ word: 'Hello', punctuatedWord: 'Hello', startMs: 200, endMs: 500, confidence: 0.99, speaker: 1, speakerConfidence: 0.99, channel: 0, language: 'en' }] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.findFirst.mockResolvedValue({
    id: ROW.id,
    direction: 'outbound',
    userId: 'user_1',
    user: { firstName: 'Avery', lastName: 'Admin' },
  })
  db.updateMany.mockResolvedValue({ count: 1 })
  db.upsert.mockResolvedValue({ id: 'transcript_1' })
  db.speakerFindMany.mockResolvedValue([])
  db.speakerCreate.mockResolvedValue({ id: 'speaker_1' })
  db.speakerUpdateMany.mockResolvedValue({ count: 1 })
  db.transaction.mockImplementation(async (callback) => callback({
    call: { findFirst: db.findFirst, updateMany: db.updateMany },
    transcript: { upsert: db.upsert },
    callSpeaker: { findMany: db.speakerFindMany, create: db.speakerCreate, updateMany: db.speakerUpdateMany },
  }))
  s3.getObjectBytes.mockResolvedValue(Buffer.from('dual-channel-mp3'))
  deepgram.transcribeCallRecording.mockResolvedValue(RESULT)
})

describe('transcribeRecordingJob', () => {
  it('reads private object bytes, requests Deepgram, and atomically writes the final transcript with its known rep', async () => {
    await transcribeRecordingJob({ callId: ROW.id })
    expect(s3.getObjectBytes).toHaveBeenCalledWith(ROW.recordingUrl)
    expect(deepgram.transcribeCallRecording).toHaveBeenCalledWith(Buffer.from('dual-channel-mp3'), 'audio/mpeg')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: ROW.id, orgId: ROW.orgId, recordingPlanned: true }, data: { transcript: RESULT.plainText, transcriptStatus: 'done' } })
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { callId: ROW.id },
      create: expect.objectContaining({ orgId: ROW.orgId, callId: ROW.id, provider: 'deepgram', plainText: RESULT.plainText }),
      update: expect.objectContaining({ provider: 'deepgram', plainText: RESULT.plainText, segments: expect.objectContaining({ deleteMany: {}, create: expect.any(Array) }) }),
    }))
    expect(db.speakerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ROW.orgId,
        callId: ROW.id,
        speakerKey: RESULT.segments[0].speakerKey,
        displayName: 'Avery Admin',
        source: 'call-user',
        userId: 'user_1',
        confidence: 1,
        evidence: { type: 'call-user', userId: 'user_1' },
      }),
    })
  })

  it.each([['the policy did not allow recording', { recordingPlanned: false }], ['the stored recording is missing', { recordingUrl: null }]])('honestly settles without Deepgram when %s', async (_reason, overrides) => {
    db.findUnique.mockResolvedValue({ ...ROW, ...overrides })
    await transcribeRecordingJob({ callId: ROW.id })
    expect(s3.getObjectBytes).not.toHaveBeenCalled()
    expect(deepgram.transcribeCallRecording).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } }, data: { transcriptStatus: 'skipped-not-recorded' } })
  })

  it('skips an already-final transcript before it can spend another provider call', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, transcriptStatus: 'done' })
    await transcribeRecordingJob({ callId: ROW.id })
    expect(s3.getObjectBytes).not.toHaveBeenCalled()
    expect(deepgram.transcribeCallRecording).not.toHaveBeenCalled()
  })

  it('retries once, then records a terminal provider failure', async () => {
    deepgram.transcribeCallRecording.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }))
    await expect(transcribeRecordingJob({ callId: ROW.id })).rejects.toThrow('down')
    await expect(transcribeRecordingJob({ callId: ROW.id }, { retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()
    expect(db.updateMany).toHaveBeenLastCalledWith({ where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } }, data: { transcriptStatus: 'failed' } })
  })

  it('captures a safe correlated terminal diagnostic when the provider fails', async () => {
    deepgram.transcribeCallRecording.mockRejectedValue(Object.assign(new Error('provider response body: call audio'), { status: 401 }))

    await expect(transcribeRecordingJob({ callId: ROW.id }, { retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({
      diagnostic: {
        correlationId: `transcribe-recording:${ROW.id}`,
        orgId: ROW.orgId,
        job: { name: 'transcribe-recording', retryCount: 1, retryLimit: 1 },
        recording: { available: true },
        provider: { name: 'deepgram', status: 401 },
        stage: 'provider',
        transcriptState: 'failed',
        nextAction: 'verify-deepgram-credentials',
      },
    })
    expect(JSON.stringify(fields)).not.toContain('call audio')
  })

  it('names persistence as the terminal stage after Deepgram already succeeded', async () => {
    db.transaction.mockRejectedValue(new Error('database rejected the transcript'))

    await expect(transcribeRecordingJob({ callId: ROW.id }, { retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({
      diagnostic: {
        provider: { name: 'deepgram', outcome: 'succeeded', status: null },
        stage: 'persistence',
        transcriptState: 'failed',
        nextAction: 'verify-transcript-persistence',
      },
    })
  })
})

describe('queue and worker wiring', () => {
  it('enqueues with one retry and passes the queue attempt counters to the job', async () => {
    queue.sendJob.mockResolvedValue('job_1')
    await expect(queueTranscribeRecording(ROW.id)).resolves.toBe('job_1')
    expect(queue.sendJob).toHaveBeenCalledWith('transcribe-recording', { callId: ROW.id }, expect.objectContaining({ retryLimit: 1 }))
    queue.workJob.mockResolvedValue('worker_1')
    await registerTranscribeRecordingWorker()
    const [, , worker] = queue.workJob.mock.calls[0]!
    deepgram.transcribeCallRecording.mockRejectedValue(new Error('down'))
    await expect(worker({ data: { callId: ROW.id }, retryCount: 0, retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT })).rejects.toThrow('down')
  })
})
