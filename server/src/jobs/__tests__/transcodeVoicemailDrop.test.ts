import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }))
vi.mock('../../db.js', () => ({
  default: { voicemailDrop: { findFirst: db.findFirst, updateMany: db.updateMany } },
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
  JOB_TRANSCODE_VOICEMAIL_DROP: 'transcode-voicemail-drop',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import {
  queueTranscodeVoicemailDrop,
  registerTranscodeVoicemailDropWorker,
  transcodeVoicemailDropJob,
  voicemailDropObjectKey,
} from '../transcodeVoicemailDrop.js'

const ROW = {
  id: 'drop_1',
  orgId: 'org_1',
  audioUrl: 'maincar-voicemail-drops/org_1/drop_1.webm',
  transcriptStatus: 'pending',
}
const PAYLOAD = { orgId: ROW.orgId, voicemailDropId: ROW.id }
const OBJECT_KEY = 'maincar-voicemail-drops/org_1/drop_1.mp3'
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

describe('voicemailDropObjectKey', () => {
  it('stores each org drop at its stable MP3 key', () => {
    expect(voicemailDropObjectKey('org_1', 'drop_1')).toBe(OBJECT_KEY)
  })
})

describe('transcodeVoicemailDropJob', () => {
  it('converts the temporary WebM, stores the MP3, and records its duration', async () => {
    await transcodeVoicemailDropJob(PAYLOAD)

    expect(s3.getObjectBytes).toHaveBeenCalledWith(ROW.audioUrl)
    expect(ffmpeg.transcodeWebmToMp3).toHaveBeenCalledWith(WEBM)
    expect(s3.putObjectBytes).toHaveBeenCalledWith({
      key: OBJECT_KEY,
      body: MP3,
      contentType: 'audio/mpeg',
    })
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, audioUrl: ROW.audioUrl },
      data: { audioUrl: OBJECT_KEY, duration: 13 },
    })
  })

  it('deletes the temporary WebM only after the MP3 is stored', async () => {
    await transcodeVoicemailDropJob(PAYLOAD)

    expect(s3.deleteObject).toHaveBeenCalledWith(ROW.audioUrl)
  })

  it('does nothing when the row is gone or its audio is already settled to MP3', async () => {
    db.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ROW, audioUrl: OBJECT_KEY })

    await transcodeVoicemailDropJob(PAYLOAD)
    await transcodeVoicemailDropJob(PAYLOAD)

    expect(s3.getObjectBytes).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('retries a conversion failure once and then marks an unfinished transcription failed', async () => {
    ffmpeg.transcodeWebmToMp3.mockRejectedValue(new Error('ffmpeg unavailable'))

    await expect(transcodeVoicemailDropJob(PAYLOAD, { retryCount: 0, retryLimit: 1 })).rejects.toThrow(
      'ffmpeg unavailable',
    )
    await expect(transcodeVoicemailDropJob(PAYLOAD, { retryCount: 1, retryLimit: 1 })).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenLastCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, transcriptStatus: { not: 'done' } },
      data: { transcriptStatus: 'failed' },
    })
  })
})

describe('queueTranscodeVoicemailDrop', () => {
  it('enqueues the drop with one retry', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueTranscodeVoicemailDrop(PAYLOAD)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'transcode-voicemail-drop',
      PAYLOAD,
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

describe('registerTranscodeVoicemailDropWorker', () => {
  it('registers a one-at-a-time worker', async () => {
    queue.workJob.mockResolvedValue('worker_1')

    await registerTranscodeVoicemailDropWorker()

    expect(queue.workJob).toHaveBeenCalledWith(
      'transcode-voicemail-drop',
      { batchSize: 1 },
      expect.any(Function),
    )
  })
})
