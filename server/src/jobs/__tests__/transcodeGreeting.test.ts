import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { voicemailGreeting: { findFirst: db.findFirst, updateMany: db.updateMany } },
}))

const s3 = vi.hoisted(() => ({ getObjectBytes: vi.fn(), putObjectBytes: vi.fn(), deleteObject: vi.fn() }))

vi.mock('../../../dependencies/s3.js', () => s3)

const ffmpeg = vi.hoisted(() => ({ transcodeWebmToMp3: vi.fn(), getAudioDurationSeconds: vi.fn() }))

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
  MAX_GREETING_DURATION_SECONDS,
  queueTranscodeGreeting,
  registerTranscodeGreetingWorker,
  TRANSCODE_GREETING_RETRY_LIMIT,
  transcodeGreetingJob,
} from '../transcodeGreeting.js'

const ROW = {
  id: 'greeting_1',
  orgId: 'org_1',
  sourceKey: 'voicemail-greeting-uploads/org_1/greeting_1.webm',
  storageKey: null,
  status: 'transcoding',
}
const PAYLOAD = { orgId: ROW.orgId, greetingId: ROW.id }
const OBJECT_KEY = 'maincar-voicemail-greetings/org_1/greeting_1.mp3'
const WEBM = Buffer.from('webm')
const MP3 = Buffer.from('mp3')

beforeEach(() => {
  vi.clearAllMocks()
  db.findFirst.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  s3.getObjectBytes.mockResolvedValue(WEBM)
  ffmpeg.transcodeWebmToMp3.mockResolvedValue(MP3)
  ffmpeg.getAudioDurationSeconds.mockResolvedValue(12.4)
  s3.putObjectBytes.mockResolvedValue(undefined)
  s3.deleteObject.mockResolvedValue(undefined)
})

describe('greetingObjectKey', () => {
  it('stores each org greeting at its stable MP3 key', () => {
    expect(greetingObjectKey('org_1', 'greeting_1')).toBe(OBJECT_KEY)
  })

  it('gives each replacement candidate an immutable output key', () => {
    expect(greetingObjectKey('org_1', 'greeting_2')).toBe(
      'maincar-voicemail-greetings/org_1/greeting_2.mp3',
    )
  })
})

describe('transcodeGreetingJob', () => {
  it('fetches the temporary upload, transcodes it, and writes the stable MP3', async () => {
    await transcodeGreetingJob(PAYLOAD)

    expect(s3.getObjectBytes).toHaveBeenCalledWith(ROW.sourceKey)
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
      where: { id: ROW.id, orgId: ROW.orgId, status: 'transcoding' },
      data: {
        storageKey: OBJECT_KEY,
        status: 'ready',
        durationSeconds: 13,
        uploadedAt: expect.any(Date),
        failureReason: null,
      },
    })
  })

  it('fails an overlong candidate without retrying or changing an active greeting', async () => {
    ffmpeg.getAudioDurationSeconds.mockResolvedValue(MAX_GREETING_DURATION_SECONDS + 1)

    await expect(transcodeGreetingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, status: 'transcoding' },
      data: {
        status: 'failed',
        failureReason: 'Greeting is longer than 120 seconds. Upload a shorter candidate.',
      },
    })
    expect(s3.putObjectBytes).not.toHaveBeenCalled()
  })

  it('deletes the temporary S3 object after a successful conversion', async () => {
    await transcodeGreetingJob(PAYLOAD)

    expect(s3.deleteObject).toHaveBeenCalledWith(ROW.sourceKey)
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
      where: { id: ROW.id, orgId: ROW.orgId, status: 'transcoding' },
      data: { status: 'failed', failureReason: 'Audio conversion failed. Upload a new candidate.' },
    })
    expect(s3.deleteObject).toHaveBeenCalledWith(ROW.sourceKey)
  })

  it('does not redo a greeting that has already reached ready, active, failed, or deleted', async () => {
    for (const status of ['ready', 'active', 'failed', 'deleted']) {
      db.findFirst.mockResolvedValue({ ...ROW, status, storageKey: OBJECT_KEY })

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
