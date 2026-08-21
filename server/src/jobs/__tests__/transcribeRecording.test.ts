// Unit tests for the call-transcription job.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma never
// connects (../../db.js), S3 is never signed (dependencies/s3.js), and OpenAI is
// never called (dependencies/openai.js). The job's whole value is deciding when to
// call OpenAI, when to skip it, and how a failure retries, and that is exactly
// what these exercise without a queue, a database, an object store, or an OpenAI
// account.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { call: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const s3 = vi.hoisted(() => ({ getRecordingDownloadUrl: vi.fn() }))

vi.mock('../../../dependencies/s3.js', () => ({
  getRecordingDownloadUrl: s3.getRecordingDownloadUrl,
}))

const openai = vi.hoisted(() => ({ transcribeRecording: vi.fn() }))

vi.mock('../../../dependencies/openai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/openai.js')>()
  return {
    // openaiErrorStatus is pure translation with no network call in it, so the
    // real one is used.
    ...actual,
    transcribeRecording: openai.transcribeRecording,
  }
})

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_TRANSCRIBE_RECORDING: 'transcribe-recording',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  queueTranscribeRecording,
  registerTranscribeRecordingWorker,
  TRANSCRIBE_RECORDING_RETRY_LIMIT,
  transcribeRecordingJob,
} from '../transcribeRecording.js'

const ROW = {
  id: 'call_1',
  orgId: 'org_1',
  recordingUrl: 'maincar-call-recordings/org_1/call_1.mp3' as string | null,
  transcriptStatus: 'pending',
}

const PAYLOAD = { callId: ROW.id }
const PRESIGNED_URL = 'https://s3.example.test/maincar-call-recordings/org_1/call_1.mp3?signature=abc'
const TRANSCRIPT = 'Hi, thanks for calling Maincar — how can I help?'

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  s3.getRecordingDownloadUrl.mockResolvedValue(PRESIGNED_URL)
  openai.transcribeRecording.mockResolvedValue(TRANSCRIPT)
})

describe('transcribeRecordingJob — happy path', () => {
  it('presigns the recording key off the Call row', async () => {
    await transcribeRecordingJob(PAYLOAD)

    expect(s3.getRecordingDownloadUrl).toHaveBeenCalledWith(ROW.recordingUrl)
  })

  it('sends the presigned URL to OpenAI', async () => {
    await transcribeRecordingJob(PAYLOAD)

    expect(openai.transcribeRecording).toHaveBeenCalledWith(PRESIGNED_URL)
  })

  it('writes the transcript and done status in ONE update', async () => {
    await transcribeRecordingJob(PAYLOAD)

    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcript: TRANSCRIPT, transcriptStatus: 'done' },
    })
  })

  // The row must never be marked done before OpenAI has actually returned text.
  it('does not write the transcript before OpenAI returns', async () => {
    let writtenDuringTranscribe = false
    openai.transcribeRecording.mockImplementation(async () => {
      writtenDuringTranscribe = db.updateMany.mock.calls.length > 0
      return TRANSCRIPT
    })

    await transcribeRecordingJob(PAYLOAD)

    expect(writtenDuringTranscribe).toBe(false)
  })
})

describe('transcribeRecordingJob — nothing to do', () => {
  it('exits cleanly when the call row is gone', async () => {
    db.findUnique.mockResolvedValue(null)

    await expect(transcribeRecordingJob({ callId: 'missing' })).resolves.toBeUndefined()

    expect(s3.getRecordingDownloadUrl).not.toHaveBeenCalled()
    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // A duplicate delivery must not spend another Whisper call on a finished row.
  it('skips when the transcript is already done', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, transcriptStatus: 'done' })

    await expect(transcribeRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(s3.getRecordingDownloadUrl).not.toHaveBeenCalled()
    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('transcribeRecordingJob — no recording', () => {
  // The headline requirement: a call with no recording is settled without ever
  // touching OpenAI.
  it('marks skipped-not-recorded and never calls OpenAI when recordingUrl is null', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingUrl: null })

    await expect(transcribeRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(s3.getRecordingDownloadUrl).not.toHaveBeenCalled()
    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'skipped-not-recorded' },
    })
  })
})

describe('transcribeRecordingJob — failures retry once then fail', () => {
  // Rethrowing is how pg-boss is told to retry; nothing is written, so the retry
  // starts clean.
  it('rethrows on the first attempt while a retry remains', async () => {
    openai.transcribeRecording.mockRejectedValue(new Error('openai 503'))

    await expect(
      transcribeRecordingJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('openai 503')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('marks transcriptStatus failed once the retry budget is spent', async () => {
    openai.transcribeRecording.mockRejectedValue(new Error('openai 503'))

    await expect(
      transcribeRecordingJob(PAYLOAD, { retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })

  it('retries exactly once by default, then settles the row failed', async () => {
    openai.transcribeRecording.mockRejectedValue(new Error('openai down'))

    // Attempt 1 (retryCount 0) hands the job back to the queue…
    await expect(transcribeRecordingJob(PAYLOAD)).rejects.toThrow()
    // …and attempt 2 (retryCount 1, the limit) settles it.
    await expect(
      transcribeRecordingJob(PAYLOAD, {
        retryCount: TRANSCRIBE_RECORDING_RETRY_LIMIT,
        retryLimit: TRANSCRIBE_RECORDING_RETRY_LIMIT,
      }),
    ).resolves.toBeUndefined()

    // Only the failed-mark write, once.
    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })

  // A failure to presign is on the same code path and must retry the same way.
  it('rethrows when the presign fails while a retry remains', async () => {
    s3.getRecordingDownloadUrl.mockRejectedValue(new Error('S3 unreachable'))

    await expect(
      transcribeRecordingJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('S3 unreachable')

    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('logs the giving-up failure with the ids, and no credentials', async () => {
    openai.transcribeRecording.mockRejectedValue(
      Object.assign(new Error('openai 401'), { status: 401 }),
    )

    await transcribeRecordingJob(PAYLOAD, { retryCount: 1, retryLimit: 1 })

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({ callId: ROW.id, orgId: ROW.orgId, status: 401 })
    expect(JSON.stringify(fields)).not.toMatch(/sk-|OPENAI_API_KEY|Bearer/i)
  })
})

describe('transcribeRecordingJob — lost race after a successful transcription', () => {
  it('leaves it alone when the row was gone or already settled', async () => {
    db.updateMany.mockResolvedValue({ count: 0 })

    await expect(transcribeRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      { callId: ROW.id, orgId: ROW.orgId },
      expect.stringContaining('already settled'),
    )
  })
})

describe('queueTranscribeRecording', () => {
  it('enqueues the job with the call id and a retry limit of one', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueTranscribeRecording(ROW.id)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'transcribe-recording',
      { callId: ROW.id },
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

// ============================================================
// registerTranscribeRecordingWorker — the wiring between pg-boss and the handler
// ============================================================
// The tests above call `transcribeRecordingJob` directly and hand it an attempt
// object by hand. This is the seam that supplies the real attempt numbers: a
// handler wired up with the wrong pair retries forever or never retries at all.
describe('registerTranscribeRecordingWorker', () => {
  /** Registers the worker and hands back the callback pg-boss would invoke. */
  async function registeredHandler() {
    queue.workJob.mockResolvedValue('worker_1')
    await registerTranscribeRecordingWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!
    return handler as (job: {
      data: { callId: string }
      retryCount: number
      retryLimit: number
    }) => Promise<void>
  }

  it('subscribes to the transcribe-recording queue one job at a time', async () => {
    await registeredHandler()

    expect(queue.workJob).toHaveBeenCalledTimes(1)
    const [name, options] = queue.workJob.mock.calls[0]!
    expect(name).toBe('transcribe-recording')
    expect(options).toEqual({ batchSize: 1 })
  })

  // First attempt: the queue still has a retry, so a failure goes back to the
  // queue rather than being written off.
  it('hands the queue’s remaining budget through, so a first failure retries', async () => {
    const handler = await registeredHandler()
    openai.transcribeRecording.mockRejectedValue(new Error('openai 503'))

    await expect(
      handler({ data: PAYLOAD, retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('openai 503')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // Same failure on the last attempt: identical input, opposite outcome, proving
  // the worker forwards the REAL counters rather than the defaults.
  it('hands the queue’s spent budget through, so the last failure settles the row', async () => {
    const handler = await registeredHandler()
    openai.transcribeRecording.mockRejectedValue(new Error('openai 503'))

    await expect(
      handler({ data: PAYLOAD, retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })
})
