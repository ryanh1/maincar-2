// Unit tests for the recording-upload job.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma never
// connects (../../db.js), Twilio is never called (dependencies/twilio.js), and S3
// is never touched (dependencies/s3.js). The job's whole value is its retry and
// idempotency behaviour, and that is exactly what these exercise without standing
// up a queue, a database, an object store, or a Twilio account.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { call: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const twilio = vi.hoisted(() => ({ fetchRecordingMp3: vi.fn(), deleteRecording: vi.fn() }))

vi.mock('../../../dependencies/twilio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/twilio.js')>()
  return {
    // twilioErrorStatus is pure translation with no SDK call in it, so the real
    // one is used: the transient/permanent split is exactly what is under test.
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
  JOB_UPLOAD_RECORDING: 'upload-recording',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

// The transcribe chain: a successful store enqueues the transcription. Mocked
// whole so this suite never loads OpenAI, and so the enqueue can be asserted.
const transcribe = vi.hoisted(() => ({ queueTranscribeRecording: vi.fn() }))

vi.mock('../transcribeRecording.js', () => ({
  queueTranscribeRecording: transcribe.queueTranscribeRecording,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  queueUploadRecording,
  recordingObjectKey,
  registerUploadRecordingWorker,
  UPLOAD_RECORDING_RETRY_LIMIT,
  uploadRecordingJob,
} from '../uploadRecording.js'

const ROW = {
  id: 'call_1',
  orgId: 'org_1',
  recordingUrl: null as string | null,
  recordingStatus: 'pending',
}

const RECORDING_SID = 'RE0123456789abcdef'
const PAYLOAD = { callId: ROW.id, recordingSid: RECORDING_SID }
const OBJECT_KEY = 'maincar-call-recordings/org_1/call_1.mp3'
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
  transcribe.queueTranscribeRecording.mockResolvedValue('transcribe_job_1')
})

describe('recordingObjectKey', () => {
  it('builds the maincar-call-recordings/{orgId}/{callId}.mp3 key', () => {
    expect(recordingObjectKey('org_1', 'call_1')).toBe(OBJECT_KEY)
  })
})

describe('uploadRecordingJob — happy path', () => {
  it('fetches the recording by its Twilio SID', async () => {
    await uploadRecordingJob(PAYLOAD)

    expect(twilio.fetchRecordingMp3).toHaveBeenCalledWith(RECORDING_SID)
  })

  it('uploads the media to the org/call key', async () => {
    await uploadRecordingJob(PAYLOAD)

    expect(s3.putRecording).toHaveBeenCalledWith(OBJECT_KEY, MEDIA.data, MEDIA.contentType)
  })

  it('writes the object key and stored status in ONE update', async () => {
    await uploadRecordingJob(PAYLOAD)

    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingStatus: { not: 'stored' } },
      data: { recordingUrl: OBJECT_KEY, recordingStatus: 'stored' },
    })
  })

  it('deletes the recording from Twilio after a successful upload', async () => {
    await uploadRecordingJob(PAYLOAD)

    expect(twilio.deleteRecording).toHaveBeenCalledWith(RECORDING_SID)
  })

  // The row must never point at an object that is not in S3 yet.
  it('does not write recordingUrl before the object is uploaded', async () => {
    let writtenDuringUpload = false
    s3.putRecording.mockImplementation(async () => {
      writtenDuringUpload = db.updateMany.mock.calls.length > 0
    })

    await uploadRecordingJob(PAYLOAD)

    expect(writtenDuringUpload).toBe(false)
  })

  // And Twilio's copy must not be deleted before ours is safely written down.
  it('does not delete from Twilio before the row is updated', async () => {
    let deletedBeforeUpdate = false
    twilio.deleteRecording.mockImplementation(async () => {
      deletedBeforeUpdate = db.updateMany.mock.calls.length === 0
    })

    await uploadRecordingJob(PAYLOAD)

    expect(deletedBeforeUpdate).toBe(false)
  })
})

describe('uploadRecordingJob — transcribe chain', () => {
  it('enqueues the transcription for the call after a successful store', async () => {
    await uploadRecordingJob(PAYLOAD)

    expect(transcribe.queueTranscribeRecording).toHaveBeenCalledTimes(1)
    expect(transcribe.queueTranscribeRecording).toHaveBeenCalledWith(ROW.id)
  })

  // Ordering matters: the transcribe job reads recordingUrl, so it must not be
  // enqueued until this upload has actually written the row.
  it('does not enqueue the transcription before the row is stored', async () => {
    let enqueuedBeforeStore = false
    transcribe.queueTranscribeRecording.mockImplementation(async () => {
      enqueuedBeforeStore = db.updateMany.mock.calls.length === 0
      return 'transcribe_job_1'
    })

    await uploadRecordingJob(PAYLOAD)

    expect(enqueuedBeforeStore).toBe(false)
  })

  it('does not enqueue the transcription when the store lost the race (count 0)', async () => {
    db.updateMany.mockResolvedValue({ count: 0 })

    await uploadRecordingJob(PAYLOAD)

    expect(transcribe.queueTranscribeRecording).not.toHaveBeenCalled()
  })

  it('does not enqueue the transcription on a permanent failure', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(404))

    await uploadRecordingJob(PAYLOAD)

    expect(transcribe.queueTranscribeRecording).not.toHaveBeenCalled()
  })

  it('does not enqueue the transcription when the recording is already stored', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingStatus: 'stored' })

    await uploadRecordingJob(PAYLOAD)

    expect(transcribe.queueTranscribeRecording).not.toHaveBeenCalled()
  })
})

describe('uploadRecordingJob — nothing to do', () => {
  it('exits cleanly when the call row is gone', async () => {
    db.findUnique.mockResolvedValue(null)

    await expect(uploadRecordingJob({ callId: 'missing', recordingSid: RECORDING_SID })).resolves
      .toBeUndefined()

    expect(twilio.fetchRecordingMp3).not.toHaveBeenCalled()
    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
  })

  // A duplicate delivery must not re-fetch a recording we have already stored and
  // deleted from Twilio (the re-fetch would 404).
  it('skips when the recording is already stored', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingStatus: 'stored' })

    await expect(uploadRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(twilio.fetchRecordingMp3).not.toHaveBeenCalled()
    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
  })

  it('skips when recordingUrl is already set', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, recordingUrl: OBJECT_KEY })

    await expect(uploadRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(twilio.fetchRecordingMp3).not.toHaveBeenCalled()
    expect(s3.putRecording).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('uploadRecordingJob — permanent failures', () => {
  // 400 = malformed request, 401/403 = auth, 404 = recording gone. A retry earns
  // the identical rejection, so the row is marked failed without a rethrow.
  it.each([400, 401, 403, 404])(
    'marks recordingStatus failed and does NOT rethrow on a %i',
    async (status) => {
      twilio.fetchRecordingMp3.mockRejectedValue(twilioError(status))

      await expect(uploadRecordingJob(PAYLOAD)).resolves.toBeUndefined()

      expect(s3.putRecording).not.toHaveBeenCalled()
      expect(twilio.deleteRecording).not.toHaveBeenCalled()
      expect(db.updateMany).toHaveBeenCalledWith({
        where: { id: ROW.id, orgId: ROW.orgId, recordingStatus: { not: 'stored' } },
        data: { recordingStatus: 'failed' },
      })
    },
  )

  it('logs the failure with the ids and the status, and no credentials', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(404))

    await uploadRecordingJob(PAYLOAD)

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({ callId: ROW.id, orgId: ROW.orgId, status: 404 })
    expect(JSON.stringify(fields)).not.toMatch(/authToken|auth_token|TWILIO_AUTH/i)
  })
})

describe('uploadRecordingJob — transient failures', () => {
  // Rethrowing is how pg-boss is told to retry; nothing is written, so the retry
  // starts clean.
  it.each([429, 500, 502, 503])('rethrows a %i while retries remain', async (status) => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(status))

    await expect(
      uploadRecordingJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('twilio said no')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('treats a network error with no HTTP status as transient', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      uploadRecordingJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('ECONNRESET')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // An S3 failure has no Twilio status, so it too is transient and retried once.
  it('rethrows when the S3 upload fails while retries remain', async () => {
    s3.putRecording.mockRejectedValue(new Error('S3 unreachable'))

    await expect(
      uploadRecordingJob(PAYLOAD, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('S3 unreachable')

    expect(db.updateMany).not.toHaveBeenCalled()
    expect(twilio.deleteRecording).not.toHaveBeenCalled()
  })

  it('marks recordingStatus failed once the retry budget is spent', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    await expect(
      uploadRecordingJob(PAYLOAD, { retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingStatus: { not: 'stored' } },
      data: { recordingStatus: 'failed' },
    })
  })

  it('retries exactly once by default', async () => {
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    // Attempt 1 (retryCount 0) hands the job back to the queue…
    await expect(uploadRecordingJob(PAYLOAD)).rejects.toThrow()
    // …and attempt 2 (retryCount 1, the limit) settles it.
    await expect(
      uploadRecordingJob(PAYLOAD, {
        retryCount: UPLOAD_RECORDING_RETRY_LIMIT,
        retryLimit: UPLOAD_RECORDING_RETRY_LIMIT,
      }),
    ).resolves.toBeUndefined()

    // Only the failed-mark write, once.
    expect(db.updateMany).toHaveBeenCalledTimes(1)
  })
})

describe('uploadRecordingJob — Twilio delete is best effort', () => {
  it('still settles successfully when the Twilio delete fails', async () => {
    twilio.deleteRecording.mockRejectedValue(new Error('twilio delete failed'))

    await expect(uploadRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    // The recording was still stored…
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingStatus: { not: 'stored' } },
      data: { recordingUrl: OBJECT_KEY, recordingStatus: 'stored' },
    })
    // …and the failed delete was logged, not thrown.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ callId: ROW.id, orgId: ROW.orgId }),
      expect.stringContaining('could not delete it from Twilio'),
    )
  })
})

describe('uploadRecordingJob — lost race after a successful upload', () => {
  it('leaves the object in place and does not delete from Twilio when the row is gone', async () => {
    db.updateMany.mockResolvedValue({ count: 0 })

    await expect(uploadRecordingJob(PAYLOAD)).resolves.toBeUndefined()

    expect(twilio.deleteRecording).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { callId: ROW.id, orgId: ROW.orgId },
      expect.stringContaining('already settled'),
    )
  })
})

describe('queueUploadRecording', () => {
  it('enqueues the job with the call id, recording SID, and a retry limit of one', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueUploadRecording(ROW.id, RECORDING_SID)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'upload-recording',
      { callId: ROW.id, recordingSid: RECORDING_SID },
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})

// ============================================================
// registerUploadRecordingWorker — the wiring between pg-boss and the handler
// ============================================================
// The tests above call `uploadRecordingJob` directly and hand it an attempt
// object by hand. This is the seam that supplies the real attempt numbers: a
// handler wired up with the wrong pair retries forever or never retries at all.
describe('registerUploadRecordingWorker', () => {
  /** Registers the worker and hands back the callback pg-boss would invoke. */
  async function registeredHandler() {
    queue.workJob.mockResolvedValue('worker_1')
    await registerUploadRecordingWorker()
    const [, , handler] = queue.workJob.mock.calls[0]!
    return handler as (job: {
      data: { callId: string; recordingSid: string }
      retryCount: number
      retryLimit: number
    }) => Promise<void>
  }

  it('subscribes to the upload-recording queue one job at a time', async () => {
    await registeredHandler()

    expect(queue.workJob).toHaveBeenCalledTimes(1)
    const [name, options] = queue.workJob.mock.calls[0]!
    expect(name).toBe('upload-recording')
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
  it('hands the queue’s spent budget through, so the last failure settles the row', async () => {
    const handler = await registeredHandler()
    twilio.fetchRecordingMp3.mockRejectedValue(twilioError(503))

    await expect(
      handler({ data: PAYLOAD, retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, recordingStatus: { not: 'stored' } },
      data: { recordingStatus: 'failed' },
    })
  })

  it('lets the handler’s throw reach pg-boss rather than swallowing it', async () => {
    const handler = await registeredHandler()
    twilio.fetchRecordingMp3.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      handler({ data: PAYLOAD, retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('ECONNRESET')
  })
})
