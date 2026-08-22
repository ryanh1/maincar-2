import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config.js', () => ({ DEEPGRAM_API_KEY: 'dg-test-key' }))

const db = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), transaction: vi.fn() }))
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
  db.updateMany.mockResolvedValue({ count: 1 })
  db.upsert.mockResolvedValue({ id: 'transcript_1' })
  db.transaction.mockImplementation(async (callback) => callback({ call: { updateMany: db.updateMany }, transcript: { upsert: db.upsert } }))
  s3.getObjectBytes.mockResolvedValue(Buffer.from('dual-channel-mp3'))
  deepgram.transcribeCallRecording.mockResolvedValue(RESULT)
})

describe('transcribeRecordingJob', () => {
  it('reads private object bytes, requests Deepgram, and atomically writes only provider-owned final transcript data', async () => {
    await transcribeRecordingJob({ callId: ROW.id })
    expect(s3.getObjectBytes).toHaveBeenCalledWith(ROW.recordingUrl)
    expect(deepgram.transcribeCallRecording).toHaveBeenCalledWith(Buffer.from('dual-channel-mp3'), 'audio/mpeg')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: ROW.id, orgId: ROW.orgId, recordingPlanned: true, transcriptStatus: { not: 'done' } }, data: { transcript: RESULT.plainText, transcriptStatus: 'done' } })
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { callId: ROW.id },
      create: expect.objectContaining({ orgId: ROW.orgId, callId: ROW.id, provider: 'deepgram', plainText: RESULT.plainText }),
      update: expect.objectContaining({ provider: 'deepgram', plainText: RESULT.plainText, segments: expect.objectContaining({ deleteMany: {}, create: expect.any(Array) }) }),
    }))
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
