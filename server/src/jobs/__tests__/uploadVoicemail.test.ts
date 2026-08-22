// Unit tests for the inbound voicemail upload job — the outbound-recording job's
// twin, operating on Voicemail instead of Call.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma never
// connects (../../db.js), Twilio is never called (dependencies/twilio.js), and S3
// is never touched (dependencies/s3.js).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { voicemail: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const twilio = vi.hoisted(() => ({ fetchRecordingMp3: vi.fn(), deleteRecording: vi.fn() }))

vi.mock('../../../dependencies/twilio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/twilio.js')>()
  return {
    ...actual,
    fetchRecordingMp3: twilio.fetchRecordingMp3,
    deleteRecording: twilio.deleteRecording,
  }
})

const s3 = vi.hoisted(() => ({ putRecording: vi.fn() }))

vi.mock('../../../dependencies/s3.js', () => ({ putRecording: s3.putRecording }))

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_UPLOAD_VOICEMAIL: 'upload-voicemail',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

const transcribe = vi.hoisted(() => ({ queueTranscribeVoicemail: vi.fn() }))
vi.mock('../transcribeVoicemail.js', () => ({
  queueTranscribeVoicemail: transcribe.queueTranscribeVoicemail,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  queueUploadVoicemail,
  registerUploadVoicemailWorker,
  UPLOAD_VOICEMAIL_RETRY_LIMIT,
  uploadVoicemailJob,
  voicemailObjectKey,
} from '../uploadVoicemail.js'

const ROW = {
  id: 'voicemail_1',
  orgId: 'org_1',
  recordingUrl: null as string | null,
}

const RECORDING_SID = 'RE0123456789abcdef'
const PAYLOAD = { voicemailId: ROW.id, recordingSid: RECORDING_SID }
const OBJECT_KEY = 'maincar-voicemail-drops/org_1/voicemail_1.mp3'
const MEDIA = { data: Buffer.from('mp3-bytes'), contentType: 'audio/mpeg' }

/** A Twilio REST/HTTP failure, which carries an HTTP status on the error. */
function twilioError(status: number): Error {
  return Object.assign(new Error('twilio said no'), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  twilio.fetchRecordingMp3.mockResolvedValue({ ...MEDIA })
  twilio.deleteRecording.mockResolvedValue(undefined)
  s3.putRecording.mockResolvedValue(undefined)
  transcribe.queueTranscribeVoicemail.mockResolvedValue('transcribe_job_1')
})

describe('voicemailObjectKey', () => {
  it('builds the maincar-voicemail-drops/{orgId}/{voicemailId}.mp3 key', () => {
    expect(voicemailObjectKey('org_1', 'voicemail_1')).toBe(OBJECT_KEY)
  })
})

describe('uploadVoicemailJob — happy path', () => {
  it('fetches the recording by its Twilio SID', async () => {
    await uploadVoicemailJob(PAYLOAD)

    expect(twilio.fetchRecordingMp3).toHaveBeenCalledWith(RECORDING_SID)
  })

  it('uploads the media to the org/voicemail key', async () => {
    await uploadVoicemailJob(PAYLOAD)

    expect(s3.putRecording).toHaveBeenCalledWith(OBJECT_KEY, MEDIA.data, MEDIA.contentType)
  })

  it('writes recordingUrl, compare-and-set on recordingUrl being null', async () => {
    await uploadVoicemailJob(PAYLOAD)

    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingUrl: null },
      data: { recordingUrl: OBJECT_KEY },
    })
  })

  it('deletes the recording from Twilio after a successful upload', async () => {
    await uploadVoicemailJob(PAYLOAD)

    expect(twilio.deleteRecording).toHaveBeenCalledWith(RECORDING_SID)
  })

  it('queues transcription only after the recording URL is stored', async () => {
    await uploadVoicemailJob(PAYLOAD)

    expect(transcribe.queueTranscribeVoicemail).toHaveBeenCalledWith(ROW.id)
  })

  // The row must never point at an object that is not in S3 yet.
  it('does not write recordingUrl before the object is uploaded', async () => {
    let writtenDuringUpload = false
    s3.putRecording.mockImplementation(async () => {
      writtenDuringUpload = db.updateMany.mock.calls.length > 0
    })

    await uploadVoicemailJob(PAYLOAD)

    expect(writtenDuringUpload).toBe(false)
  })

  // And Twilio's copy must not be deleted before ours is safely written down.
  it('does not delete from Twilio before the row is updated', async () => {
    let deletedBeforeUpdate = false
    twilio.deleteRecording.mockImplementation(async () => {
      deletedBeforeUpdate = db.updateMany.mock.calls.length === 0
    })

    await uploadVoicemailJob(PAYLOAD)

    expect(deletedBeforeUpdate).toBe(false)
  })
})

describe('uploadVoicemailJob — nothing to do', () => {
  it('exits cleanly when the voicemail row is gone', async () => {
    db.findUnique.mockResolvedValue(null)

    await expect(
      uploadVoicemailJob({ voicemailId: 'missing', recordingSid: RECORDING_SID }),
    ).resolves.toBeUndefined()

    expect(twilio.fetchRecordingMp3).not.toHaveBeenCalled()
    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
  })

  // A duplicate delivery must not re-fetch a recording we have already stored and
  // deleted from Twilio (the re-fetch would 404).
  it('skips when recordingUrl is already set', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingUrl: OBJECT_KEY })

    await expect(uploadVoicemailJob(PAYLOAD)).resolves.toBeUndefined()

    expect(twilio.fetchRecordingMp3).not.toHaveBeenCalled()
    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('uploadVoicemailJob — permanent failures', () => {
  // 400 = malformed request, 401/403 = auth, 404 = recording gone. A retry earns
  // the identical rejection, so the job just settles without a rethrow — and
  // leaves recordingUrl null rather than guessing at a value.
  it.each([400, 401, 403, 404])('does NOT rethrow on a %i, and writes nothing', async (status) => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(status))

    await expect(uploadVoicemailJob(PAYLOAD)).resolves.toBeUndefined()

    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('logs the failure with the ids and the status, and no credentials', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(404))

    await uploadVoicemailJob(PAYLOAD)

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({ voicemailId: ROW.id, orgId: ROW.orgId, status: 404 })
    expect(JSON.stringify(fields)).not.toMatch(/authToken|auth_token|TWILIO_AUTH/i)
  })
})

describe('uploadVoicemailJob — transient failures', () => {
  // Rethrowing is how pg-boss is told to retry; nothing is written, so the retry
  // starts clean.
  it.each([429, 500, 502, 503])('rethrows a %i while retries remain', async (status) => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(status))

    await expect(
      uploadVoicemailJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('twilio said no')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('treats a network error with no HTTP status as transient', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      uploadVoicemailJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('ECONNRESET')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // An S3 failure has no Twilio status, so it too is transient and retried once.
  it('rethrows when the S3 upload fails while retries remain', async () => {
    s3.putRecording.mockRejectedValue(new Error('S3 unreachable'))

    await expect(
      uploadVoicemailJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('S3 unreachable')

    expect(db.updateMany).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
  })

  it('settles without writing once the retry budget is spent', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    await expect(
      uploadVoicemailJob(PAYLOAD, { retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('retries exactly once by default', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    // Attempt 1 (retryCount 0) hands the job back to the queue…
    await expect(uploadVoicemailJob(PAYLOAD)).rejects.toThrow()
    // …and attempt 2 (retryCount 1, the limit) settles it.
    await expect(
      uploadVoicemailJob(PAYLOAD, {
        retryCount: UPLOAD_VOICEMAIL_RETRY_LIMIT,
        retryLimit: UPLOAD_VOICEMAIL_RETRY_LIMIT,
      }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('uploadVoicemailJob — Twilio delete is best effort', () => {
  it('still settles successfully when the Twilio delete fails', async () => {
    twilio.deleteRecording.mockRejectedValue(new Error('twilio delete failed'))

    await expect(uploadVoicemailJob(PAYLOAD)).resolves.toBeUndefined()

    // The recording was still stored…
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingUrl: null },
      data: { recordingUrl: OBJECT_KEY },
    })
    // …and the failed delete was logged, not thrown.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ voicemailId: ROW.id, orgId: ROW.orgId }),
      expect.stringContaining('could not delete it from Twilio'),
    )
  })
})

describe('uploadVoicemailJob — lost race after a successful upload', () => {
  it('leaves the object in place and does not delete from Twilio when the row is gone', async () => {
    db.updateMany.mockResolvedValue({ count: 0 })

    await expect(uploadVoicemailJob(PAYLOAD)).resolves.toBeUndefined()

    expect(twilio.deleteRecording).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { voicemailId: ROW.id, orgId: ROW.orgId },
      expect.stringContaining('already settled'),
    )
  })
})

describe('queueUploadVoicemail', () => {
  it('enqueues the job with the voicemail id, recording SID, and a retry limit of one', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueUploadVoicemail(ROW.id, RECORDING_SID)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'upload-voicemail',
      { voicemailId: ROW.id, recordingSid: RECORDING_SID },
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

// ============================================================
// registerUploadVoicemailWorker — the wiring between pg-boss and the handler
// ============================================================
describe('registerUploadVoicemailWorker', () => {
  /** Registers the worker and hands back the callback pg-boss would invoke. */
  async function registeredHandler() {
    queue.workJob.mockResolvedValue('worker_1')
    await registerUploadVoicemailWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!
    return handler as (job: {
      data: { voicemailId: string; recordingSid: string }
      retryCount: number
      retryLimit: number
    }) => Promise<void>
  }

  it('subscribes to the upload-voicemail queue one job at a time', async () => {
    await registeredHandler()

    expect(queue.workJob).toHaveBeenCalledTimes(1)
    const [name, options] = queue.workJob.mock.calls[0]!
    expect(name).toBe('upload-voicemail')
    expect(options).toEqual({ batchSize: 1 })
  })

  it('passes the job payload through to the handler unchanged', async () => {
    const handler = await registeredHandler()

    await handler({ data: PAYLOAD, retryCount: 0, retryLimit: 1 })

    expect(twilio.fetchRecordingMp3).toHaveBeenCalledWith(RECORDING_SID)
  })

  // First attempt: the queue still has a retry, so a transient failure goes back
  // to the queue rather than being written off.
  it('hands the queue’s remaining budget through, so a first failure retries', async () => {
    const handler = await registeredHandler()
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    await expect(
      handler({ data: PAYLOAD, retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('twilio said no')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // Same failure on the last attempt: identical input, opposite outcome, proving
  // the worker forwards the REAL counters rather than the defaults.
  it('hands the queue’s spent budget through, so the last failure settles without a rethrow', async () => {
    const handler = await registeredHandler()
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    await expect(
      handler({ data: PAYLOAD, retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('lets the handler’s throw reach pg-boss rather than swallowing it', async () => {
    const handler = await registeredHandler()
    twilio.fetchRecordingMp3.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      handler({ data: PAYLOAD, retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('ECONNRESET')
  })
})
