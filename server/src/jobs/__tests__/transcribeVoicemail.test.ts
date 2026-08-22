import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }))
vi.mock('../../db.js', () => ({
  default: { voicemail: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const s3 = vi.hoisted(() => ({ getRecordingDownloadUrl: vi.fn() }))
vi.mock('../../../dependencies/s3.js', () => ({ getRecordingDownloadUrl: s3.getRecordingDownloadUrl }))

const openai = vi.hoisted(() => ({ transcribeRecording: vi.fn() }))
vi.mock('../../../dependencies/openai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/openai.js')>()
  return { ...actual, transcribeRecording: openai.transcribeRecording }
})

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_TRANSCRIBE_VOICEMAIL: 'transcribe-voicemail',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import {
  queueTranscribeVoicemail,
  registerTranscribeVoicemailWorker,
  transcribeVoicemailJob,
} from '../transcribeVoicemail.js'

const ROW = {
  id: 'voicemail_1',
  orgId: 'org_1',
  recordingUrl: 'maincar-voicemail-drops/org_1/voicemail_1.mp3' as string | null,
  transcriptStatus: 'pending',
}
const PAYLOAD = { voicemailId: ROW.id }
const PRESIGNED_URL = 'https://s3.example.test/maincar-voicemail-drops/org_1/voicemail_1.mp3?sig=abc'
const TRANSCRIPT = 'Please call me back about the proposal.'

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  s3.getRecordingDownloadUrl.mockResolvedValue(PRESIGNED_URL)
  openai.transcribeRecording.mockResolvedValue(TRANSCRIPT)
})

describe('transcribeVoicemailJob', () => {
  it('downloads the stored S3 recording and writes Whisper text as done', async () => {
    await transcribeVoicemailJob(PAYLOAD)

    expect(s3.getRecordingDownloadUrl).toHaveBeenCalledWith(ROW.recordingUrl)
    expect(openai.transcribeRecording).toHaveBeenCalledWith(PRESIGNED_URL)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcript: TRANSCRIPT, transcriptStatus: 'done' },
    })
  })

  it('does nothing when the voicemail was deleted or is already transcribed', async () => {
    db.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ROW, transcriptStatus: 'done' })

    await transcribeVoicemailJob(PAYLOAD)
    await transcribeVoicemailJob(PAYLOAD)

    expect(s3.getRecordingDownloadUrl).not.toHaveBeenCalled()
    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('settles a stale job without a recording as failed without calling Whisper', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingUrl: null })

    await transcribeVoicemailJob(PAYLOAD)

    expect(s3.getRecordingDownloadUrl).not.toHaveBeenCalled()
    expect(openai.transcribeRecording).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })

  it('rethrows the first failure so pg-boss retries it once', async () => {
    openai.transcribeRecording.mockRejectedValue(new Error('OpenAI unavailable'))

    await expect(transcribeVoicemailJob(PAYLOAD, { retryCount: 0, retryLimit: 1 })).rejects.toThrow(
      'OpenAI unavailable',
    )
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('marks the voicemail failed after its one retry is spent', async () => {
    openai.transcribeRecording.mockRejectedValue(new Error('OpenAI unavailable'))

    await expect(transcribeVoicemailJob(PAYLOAD, { retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })
})

describe('queueTranscribeVoicemail', () => {
  it('enqueues one retry for the voicemail', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueTranscribeVoicemail(ROW.id)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'transcribe-voicemail',
      { voicemailId: ROW.id },
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

describe('registerTranscribeVoicemailWorker', () => {
  it('registers a single-job worker and forwards the real retry counters', async () => {
    queue.workJob.mockResolvedValue('worker_1')

    await registerTranscribeVoicemailWorker()

    expect(queue.workJob).toHaveBeenCalledWith('transcribe-voicemail', { batchSize: 1 }, expect.any(Function))
    const handler = queue.workJob.mock.calls[0]![2] as (job: {
      data: typeof PAYLOAD
      retryCount: number
      retryLimit: number
    }) => Promise<void>
    openai.transcribeRecording.mockRejectedValue(new Error('OpenAI unavailable'))

    await expect(handler({ data: PAYLOAD, retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })
})
