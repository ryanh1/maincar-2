// Unit tests for the one background job that spends money.
//
// Everything external is mocked: pg-boss never starts (../queue.js), Prisma never
// connects (../../db.js), and Twilio is never called (dependencies/twilio.js).
// That last one is not a convenience — a real `buyPhoneNumber` in a test run
// would rent a phone number and bill it, every run, forever.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const PUBLIC_BASE_URL = 'https://maincar.example.test'

// Mutable so the "PUBLIC_BASE_URL is not set" case can blank it out without
// depending on whatever the developer happens to have in their .env.
const env = vi.hoisted(() => ({ publicBaseUrl: 'https://maincar.example.test' }))

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config.js')>()
  return {
    ...actual,
    get PUBLIC_BASE_URL() {
      return env.publicBaseUrl
    },
  }
})

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  default: { phoneNumber: { findUnique: db.findUnique, updateMany: db.updateMany } },
}))

const twilio = vi.hoisted(() => ({ buyPhoneNumber: vi.fn() }))

vi.mock('../../../dependencies/twilio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dependencies/twilio.js')>()
  return {
    // twilioErrorStatus is pure translation with no SDK call in it, so the real
    // one is used: the transient/permanent split is exactly what is under test.
    ...actual,
    buyPhoneNumber: twilio.buyPhoneNumber,
  }
})

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const queue = vi.hoisted(() => ({ sendJob: vi.fn(), workJob: vi.fn() }))

vi.mock('../queue.js', () => ({
  JOB_PROVISION_NUMBER: 'provision-number',
  sendJob: queue.sendJob,
  workJob: queue.workJob,
}))

import { logger } from '../../../dependencies/logger.js'
import {
  PROVISION_NUMBER_RETRY_LIMIT,
  provisionNumberJob,
  queueProvisionNumber,
  voiceWebhookUrl,
  WebhookBaseUrlMissingError,
} from '../provisionNumber.js'

const ROW = {
  id: 'pn_1',
  orgId: 'org_1',
  e164: '+14155550123',
  status: 'searching',
}

/** A Twilio REST failure, which carries an HTTP status the SDK put on the error. */
function twilioError(status: number): Error {
  return Object.assign(new Error('twilio said no'), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  env.publicBaseUrl = PUBLIC_BASE_URL
  db.findUnique.mockResolvedValue({ ...ROW })
  db.updateMany.mockResolvedValue({ count: 1 })
  twilio.buyPhoneNumber.mockResolvedValue({
    sid: 'PN0123456789abcdef',
    e164: ROW.e164,
    voiceUrl: `${PUBLIC_BASE_URL}/api/twilio/voice`,
  })
})

describe('voiceWebhookUrl', () => {
  it('builds the callback from PUBLIC_BASE_URL, never a bare path', () => {
    expect(voiceWebhookUrl()).toBe(`${PUBLIC_BASE_URL}/api/twilio/voice`)
  })

  it('throws a named error when PUBLIC_BASE_URL is empty', () => {
    env.publicBaseUrl = ''
    expect(() => voiceWebhookUrl()).toThrow(WebhookBaseUrlMissingError)
  })
})

describe('provisionNumberJob — happy path', () => {
  it('buys the row’s number and points it at our voice webhook', async () => {
    await provisionNumberJob({ phoneNumberId: ROW.id })

    expect(twilio.buyPhoneNumber).toHaveBeenCalledWith({
      e164: ROW.e164,
      voiceUrl: `${PUBLIC_BASE_URL}/api/twilio/voice`,
    })
  })

  it('writes status and the SID Twilio returned in ONE update', async () => {
    await provisionNumberJob({ phoneNumberId: ROW.id })

    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, status: 'searching' },
      data: { status: 'active', twilioSid: 'PN0123456789abcdef' },
    })
  })

  // The row must never say "active" before Twilio confirmed the sale.
  it('does not touch the row before the purchase resolves', async () => {
    let updatedDuringPurchase = false
    twilio.buyPhoneNumber.mockImplementation(async () => {
      updatedDuringPurchase = db.updateMany.mock.calls.length > 0
      return { sid: 'PNlate', e164: ROW.e164, voiceUrl: 'x' }
    })

    await provisionNumberJob({ phoneNumberId: ROW.id })

    expect(updatedDuringPurchase).toBe(false)
  })
})

describe('provisionNumberJob — nothing to do', () => {
  it('exits cleanly when the row is gone', async () => {
    db.findUnique.mockResolvedValue(null)

    await expect(provisionNumberJob({ phoneNumberId: 'missing' })).resolves.toBeUndefined()

    expect(twilio.buyPhoneNumber).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  // The expensive failure mode: a duplicate delivery must not rent a second
  // number for a row that has already been paid for.
  it.each(['active', 'failed', 'releasing'])(
    'buys nothing when the row is already %s',
    async (status) => {
      db.findUnique.mockResolvedValue({ ...ROW, status })

      await expect(provisionNumberJob({ phoneNumberId: ROW.id })).resolves.toBeUndefined()

      expect(twilio.buyPhoneNumber).not.toHaveBeenCalled()
      expect(db.updateMany).not.toHaveBeenCalled()
    },
  )
})

describe('provisionNumberJob — configuration failure', () => {
  it('fails the row without calling Twilio when PUBLIC_BASE_URL is missing', async () => {
    env.publicBaseUrl = ''

    await expect(provisionNumberJob({ phoneNumberId: ROW.id })).resolves.toBeUndefined()

    expect(twilio.buyPhoneNumber).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, status: 'searching' },
      data: { status: 'failed' },
    })
  })
})

describe('provisionNumberJob — permanent Twilio failures', () => {
  // 400 = malformed E.164, 404 = Twilio no longer has it, 421 = already sold.
  it.each([400, 401, 403, 404, 421])(
    'marks the row failed and does NOT rethrow on a %i',
    async (status) => {
      twilio.buyPhoneNumber.mockRejectedValue(twilioError(status))

      await expect(provisionNumberJob({ phoneNumberId: ROW.id })).resolves.toBeUndefined()

      expect(db.updateMany).toHaveBeenCalledWith({
        where: { id: ROW.id, orgId: ROW.orgId, status: 'searching' },
        data: { status: 'failed' },
      })
    },
  )

  it('logs the failure with the ids and the Twilio status, and no credentials', async () => {
    twilio.buyPhoneNumber.mockRejectedValue(twilioError(400))

    await provisionNumberJob({ phoneNumberId: ROW.id })

    const [fields] = vi.mocked(logger.error).mock.calls.at(-1) ?? []
    expect(fields).toMatchObject({
      phoneNumberId: ROW.id,
      orgId: ROW.orgId,
      twilioStatus: 400,
    })
    expect(JSON.stringify(fields)).not.toMatch(/authToken|auth_token|TWILIO_AUTH/i)
  })
})

describe('provisionNumberJob — transient Twilio failures', () => {
  // Rethrowing is how pg-boss is told to retry; the row stays "searching" so the
  // retry can pick up exactly where this attempt left off.
  it.each([429, 500, 502, 503])('rethrows a %i while retries remain', async (status) => {
    twilio.buyPhoneNumber.mockRejectedValue(twilioError(status))

    await expect(
      provisionNumberJob({ phoneNumberId: ROW.id }, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('twilio said no')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('treats a network error with no HTTP status as transient', async () => {
    twilio.buyPhoneNumber.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      provisionNumberJob({ phoneNumberId: ROW.id }, { retryCount: 0, retryLimit: 1 }),
    ).rejects.toThrow('ECONNRESET')

    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('marks the row failed once the retry budget is spent', async () => {
    twilio.buyPhoneNumber.mockRejectedValue(twilioError(503))

    await expect(
      provisionNumberJob({ phoneNumberId: ROW.id }, { retryCount: 1, retryLimit: 1 }),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, orgId: ROW.orgId, status: 'searching' },
      data: { status: 'failed' },
    })
  })

  it('retries exactly once by default', async () => {
    twilio.buyPhoneNumber.mockRejectedValue(twilioError(503))

    // Attempt 1 (retryCount 0) hands the job back to the queue…
    await expect(provisionNumberJob({ phoneNumberId: ROW.id })).rejects.toThrow()
    // …and attempt 2 (retryCount 1, the limit) settles it.
    await expect(
      provisionNumberJob(
        { phoneNumberId: ROW.id },
        { retryCount: PROVISION_NUMBER_RETRY_LIMIT, retryLimit: PROVISION_NUMBER_RETRY_LIMIT },
      ),
    ).resolves.toBeUndefined()

    expect(db.updateMany).toHaveBeenCalledTimes(1)
  })
})

describe('provisionNumberJob — lost race after a successful purchase', () => {
  it('logs loudly when the row moved out of searching mid-purchase', async () => {
    db.updateMany.mockResolvedValue({ count: 0 })

    await expect(provisionNumberJob({ phoneNumberId: ROW.id })).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      { phoneNumberId: ROW.id, orgId: ROW.orgId },
      expect.stringContaining('no longer searching'),
    )
  })
})

describe('queueProvisionNumber', () => {
  it('enqueues the job with the row id and a retry limit of one', async () => {
    queue.sendJob.mockResolvedValue('job_1')

    await expect(queueProvisionNumber(ROW.id)).resolves.toBe('job_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'provision-number',
      { phoneNumberId: ROW.id },
      expect.objectContaining({ retryLimit: 1 }),
    )
  })
})
