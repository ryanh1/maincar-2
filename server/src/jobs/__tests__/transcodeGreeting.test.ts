import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { voicemailGreeting: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const s3 = vi.hoisted(() => ({ getObjectBytes: vi.fn(), putObjectBytes: vi.fn(), deleteObject: vi.fn() }))

vi.mock('../../../dependencies/s3.js', () => s3)

const ffmpeg = vi.hoisted(() => ({ transcodeWebmToMp3: vi.fn() }))

vi.mock('../../../dependencies/ffmpeg.js', () => ffmpeg)

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_TRANSCODE_GREETING: 'transcode-greeting',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import {
  greetingObjectKey,
  queueTranscodeGreeting,
  registerTranscodeGreetingWorker,
  TRANSCODE_GREETING_RETRY_LIMIT,
  transcodeGreetingJob,
} from '../transcodeGreeting.js'

const ROW = { id: 'greeting_1', orgId: 'org_1', audioUrl: null, status: 'pending' }
const PAYLOAD = { orgId: ROW.orgId, tempObjectKey: 'voicemail-greeting-uploads/org_1/upload.webm' }
const OBJECT_KEY = 'maincar-voicemail-greetings/org_1/greeting.mp3'
const WEBM = Buffer.from('webm')
const MP3 = Buffer.from('mp3')

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  s3.getObjectBytes.mockResolvedValue(WEBM)
  ffmpeg.transcodeWebmToMp3.mockResolvedValue(MP3)
  s3.putObjectBytes.mockResolvedValue(undefined)
  s3.deleteObject.mockResolvedValue(undefined)
})

describe('greetingObjectKey', () => {
  it('stores each org greeting at its stable MP3 key', () => {
    expect(greetingObjectKey('org_1')).toBe(OBJECT_KEY)
  })
})

describe('transcodeGreetingJob', () => {
  it('fetches the temporary upload, transcodes it, and writes the stable MP3', async () => {
    await transcodeGreetingJob(PAYLOAD)

    expect(s3.getObjectBytes).toHaveBeenCalledWith(PAYLOAD.tempObjectKey)
    expect(ffmpeg.transcodeWebmToMp3).toHaveBeenCalledWith(WEBM)
    expect(s3.putObjectBytes).toHaveBeenCalledWith({
      key: OBJECT_KEY,
      body: MP3,
      contentType: 'audio/mpeg',
    })
  })

  it('records the stable key and ready status only after the MP3 is stored', async () => {
    await transcodeGreetingJob(PAYLOAD)

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { orgId: ROW.orgId, status: 'pending' },
      data: { audioUrl: OBJECT_KEY, status: 'ready', uploadedAt: expect.any(Date) },
    })
  })

  it('deletes the temporary S3 object after a successful conversion', async () => {
    await transcodeGreetingJob(PAYLOAD)

    expect(s3.deleteObject).toHaveBeenCalledWith(PAYLOAD.tempObjectKey)
  })

  it('retries once for a transient failure, then marks the greeting failed', async () => {
    ffmpeg.transcodeWebmToMp3.mockRejectedValue(new Error('ffmpeg unavailable'))

    await expect(
      transcodeGreetingJob(PAYLOAD, { retryCount: 0, retryLimit: TRANSCODE_GREETING_RETRY_LIMIT }),
    ).rejects.toThrow('ffmpeg unavailable')

    await expect(
      transcodeGreetingJob(PAYLOAD, {
        retryCount: TRANSCODE_GREETING_RETRY_LIMIT,
        retryLimit: TRANSCODE_GREETING_RETRY_LIMIT,
      }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenLastCalledWith({
      where: { orgId: ROW.orgId, status: 'pending' },
      data: { status: 'failed' },
    })
    expect(s3.deleteObject).toHaveBeenCalledWith(PAYLOAD.tempObjectKey)
  })

  it('does not redo a greeting that has already reached ready or failed', async () => {
    for (const status of ['ready', 'failed']) {
      db.findUnique.mockResolvedValue({ ...ROW, status, audioUrl: OBJECT_KEY })

      await transcodeGreetingJob(PAYLOAD)

      expect(s3.getObjectBytes).not.toHaveBeenCalled()
      expect(db.updateMany).not.toHaveBeenCalled()
    }
  })
})

describe('queueTranscodeGreeting', () => {
  it('enqueues a single retry with the org and temporary object key', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueTranscodeGreeting(PAYLOAD)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'transcode-greeting',
      PAYLOAD,
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

describe('registerTranscodeGreetingWorker', () => {
  it('registers a one-at-a-time worker and passes the queue retry budget through', async () => {
    queue.workJob.mockResolvedValue('worker_1')

    await registerTranscodeGreetingWorker()

    expect(queue.workJob).toHaveBeenCalledWith(
      'transcode-greeting',
      { batchSize: 1 },
      expect.any(Function),
    )
  })
})
