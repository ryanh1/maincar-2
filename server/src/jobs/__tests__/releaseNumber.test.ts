// Unit tests for the job that stops the org paying for a number.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma never
// connects (../../db.js), and Twilio is never called (dependencies/twilio.js).
// That last one matters in the opposite direction from its buying twin — a real
// `releasePhoneNumber` here would give away a number somebody is using.
//
// The theme running through all of it: a release that does not happen leaves a
// bill nobody asked for, so this job retries harder than provisionNumber does and
// never leaves a row stranded in "releasing".
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: {
    phoneNumber: {
      findUnique: db.findUnique,
      updateMany: db.updateMany,
      deleteMany: db.deleteMany,
    },
  },
}))

const twilio = vi.hoisted(() => ({ releasePhoneNumber: vi.fn() }))

vi.mock('../../../dependencies/twilio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/twilio.js')>()
  return {
    // twilioErrorStatus is pure translation with no SDK call in it, so the real
    // one is used: the transient/permanent split is exactly what is under test.
    ...actual,
    releasePhoneNumber: twilio.releasePhoneNumber,
  }
})

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_RELEASE_NUMBER: 'release-number',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  RELEASE_NUMBER_RETRY_LIMIT,
  queueReleaseNumber,
  registerReleaseNumberWorker,
  releaseNumberJob,
} from '../releaseNumber.js'

const ROW = {
  id: 'pn_1',
  orgId: 'org_1',
  status: 'releasing',
  twilioSid: 'PN123',
}

/** A Twilio REST failure, which carries an HTTP status the SDK put on the error. */
function twilioError(status: number): Error {
  return Object.assign(new Error('twilio said no'), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  db.deleteMany.mockResolvedValue({ count: 1 })
  twilio.releasePhoneNumber.mockResolvedValue(undefined)
  queue.sendJob.mockResolvedValue('job-1')
  queue.workJob.mockResolvedValue('worker-1')
})

describe('releaseNumberJob — the happy path', () => {
  it('releases the number at Twilio and then deletes the row', async () => {
    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(twilio.releasePhoneNumber).toHaveBeenCalledWith('PN123')
    expect(db.deleteMany).toHaveBeenCalledTimes(1)
  })

  // The order is the whole safety property. Deleting first would lose the SID,
  // and with it any way to ever stop the charge.
  it('does not delete the row until Twilio has answered', async () => {
    let releasedBeforeDelete = false
    twilio.releasePhoneNumber.mockImplementation(() => {
      expect(db.deleteMany).not.toHaveBeenCalled()
      releasedBeforeDelete = true
      return Promise.resolve()
    })

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(releasedBeforeDelete).toBe(true)
    expect(db.deleteMany).toHaveBeenCalledTimes(1)
  })

  // deleteMany with the tenant key, never delete({ where: { id } }), and a
  // compare-and-set on the status so a row somebody else has moved is left alone.
  it('scopes the delete by orgId and by the status it expects', async () => {
    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(db.deleteMany.mock.calls[0]![0].where).toEqual({
      id: ROW.id,
      orgId: ROW.orgId,
      status: 'releasing',
    })
  })
})

describe('releaseNumberJob — nothing to release', () => {
  // No SID means Twilio never sold us this number: the row is a failed purchase
  // the person is clearing out. There is no charge to stop.
  it('deletes a row that has no Twilio SID without calling Twilio', async () => {
    db.findUnique.mockResolvedValue({ ...ROW, twilioSid: null })

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(twilio.releasePhoneNumber).not.toHaveBeenCalled()
    expect(db.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when the row is already gone', async () => {
    db.findUnique.mockResolvedValue(null)

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(twilio.releasePhoneNumber).not.toHaveBeenCalled()
    expect(db.deleteMany).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe('releaseNumberJob — the idempotency guard', () => {
  // pg-boss is at-least-once. A row that is no longer "releasing" is one the org
  // has decided to keep, and releasing it would give away a number in use.
  it.each(['active', 'searching', 'failed'])(
    'refuses to release a row whose status is %s',
    async (status) => {
      db.findUnique.mockResolvedValue({ ...ROW, status })

      await releaseNumberJob({ phoneNumberId: ROW.id })

      expect(twilio.releasePhoneNumber).not.toHaveBeenCalled()
      expect(db.deleteMany).not.toHaveBeenCalled()
    },
  )
})

describe('releaseNumberJob — Twilio failures', () => {
  // 404 is success wearing a different hat: Twilio does not have the number, so
  // nobody is being billed for it. That is the entire goal of the job, and it is
  // what makes a retry after a lost response safe.
  it('treats a 404 from Twilio as released and deletes the row', async () => {
    twilio.releasePhoneNumber.mockRejectedValue(twilioError(404))

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(db.deleteMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // Rethrowing is how pg-boss is told to retry. The row stays "releasing", so the
  // next delivery gets past the guard above and tries again.
  it.each([null, 429, 500, 503])(
    'hands a transient failure (%s) back to the queue with the row still releasing',
    async (status) => {
      twilio.releasePhoneNumber.mockRejectedValue(
        status === null ? new Error('socket hang up') : twilioError(status),
      )

      await expect(releaseNumberJob({ phoneNumberId: ROW.id })).rejects.toThrow()

      expect(db.deleteMany).not.toHaveBeenCalled()
      expect(db.updateMany).not.toHaveBeenCalled()
    },
  )

  // A 4xx that is not 404 means Twilio read the request and refused. A retry
  // replays it and earns the same refusal, so the job stops asking.
  it('gives up on a permanent failure and puts the row back to active', async () => {
    twilio.releasePhoneNumber.mockRejectedValue(twilioError(400))

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(db.deleteMany).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: ROW.id, orgId: ROW.orgId, status: 'releasing' },
      data: { status: 'active' },
    })
  })

  // The row must never be stranded in "releasing": the release route refuses a
  // row that is already releasing, so a stranded row is a number nobody can ever
  // get rid of — the exact bug this feature exists to fix.
  it('never leaves a row releasing once the retry budget is spent', async () => {
    twilio.releasePhoneNumber.mockRejectedValue(twilioError(503))

    await releaseNumberJob(
      { phoneNumberId: ROW.id },
      { retryCount: RELEASE_NUMBER_RETRY_LIMIT, retryLimit: RELEASE_NUMBER_RETRY_LIMIT },
    )

    expect(db.updateMany.mock.calls[0]![0].data.status).toBe('active')
  })

  // "active" and not "active plus the caller ID it used to be". A number that
  // spent time half-released is picked back up on purpose or not at all.
  it('does not restore isActiveForOutbound when it gives up', async () => {
    twilio.releasePhoneNumber.mockRejectedValue(twilioError(400))

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(db.updateMany.mock.calls[0]![0].data).not.toHaveProperty('isActiveForOutbound')
  })

  // A number still being rented is a bill nobody asked for, so it is an error,
  // not a warning — and the log line carries identifiers only.
  it('logs a permanent failure at error level, with no phone number in it', async () => {
    twilio.releasePhoneNumber.mockRejectedValue(twilioError(400))

    await releaseNumberJob({ phoneNumberId: ROW.id })

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [context] = vi.mocked(logger.error).mock.calls[0]!
    expect(context).toMatchObject({ phoneNumberId: ROW.id, orgId: ROW.orgId })
    expect(JSON.stringify(context)).not.toContain('+1')
  })
})

describe('queueReleaseNumber', () => {
  it('sends the release job with its own retry budget', async () => {
    await queueReleaseNumber('pn_9')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'release-number',
      { phoneNumberId: 'pn_9' },
      { retryLimit: RELEASE_NUMBER_RETRY_LIMIT, retryDelay: 60 },
    )
  })

  // More retries than provisioning gets, and the asymmetry is deliberate: a
  // purchase that fails costs nothing, a release that fails costs money monthly.
  it('retries more than once', () => {
    expect(RELEASE_NUMBER_RETRY_LIMIT).toBeGreaterThan(1)
  })
})

describe('registerReleaseNumberWorker', () => {
  it('works one job at a time and passes the attempt through', async () => {
    await registerReleaseNumberWorker()

    const [name, options, handler] = queue.workJob.mock.calls[0]!
    expect(name).toBe('release-number')
    expect(options).toEqual({ batchSize: 1 })

    await handler({ data: { phoneNumberId: ROW.id }, retryCount: 1, retryLimit: 3 })
    expect(twilio.releasePhoneNumber).toHaveBeenCalledWith('PN123')
  })
})
