// Route tests for /api/orgs/:orgId/phone-numbers.
//
// The org-isolation block at the bottom proves that a caller from Org A cannot
// read Org B's numbers, that an unauthenticated caller is rejected, and that the
// tenant key really is in the where clause rather than only in the path.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock, listNumbersMock, getPriceMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    phoneNumber: { findMany: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
  listNumbersMock: vi.fn(),
  getPriceMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
// The Twilio wrapper, not the SDK. Mocking our own module is what makes the
// route testable without a network, an account, or a cent of spend — and it is
// only possible because the SDK is constructed in exactly one file.
vi.mock('../../../dependencies/twilio.js', () => ({
  listAvailableLocalNumbers: listNumbersMock,
  getLocalNumberMonthlyPrice: getPriceMock,
  // Not mocked away: the real predicate is what decides 400-vs-500 below, and a
  // stub of it would test the stub.
  twilioErrorStatus: (error: unknown) => {
    const status = (error as { status?: unknown } | null)?.status
    return typeof status === 'number' ? status : null
  },
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/phone-numbers`
const SEARCH_A = `${URL_A}/search`

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@orga.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: 'America/New_York',
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: ORG_A,
    roles: ['basic'],
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function numberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'num-1',
    orgId: ORG_A,
    assignedUserId: 'user-a',
    e164: '+12025550123',
    twilioSid: 'PN123',
    status: 'active',
    isActiveForOutbound: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  // The gate looks the caller's membership up per request; null means "not a member".
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.phoneNumber.findMany.mockResolvedValue([])
  listNumbersMock.mockResolvedValue([])
  getPriceMock.mockResolvedValue({ amount: '1.15', currency: 'USD' })
})

/** What the Twilio wrapper hands back for one number Twilio has for sale. */
function availableRow(overrides: Record<string, unknown> = {}) {
  return { e164: '+14155550123', friendly: '(415) 555-0123', ...overrides }
}

/** A Twilio REST failure, which carries an HTTP status the route reads. */
function twilioError(status: number) {
  return Object.assign(new Error('Twilio said no'), { status })
}

describe('GET /api/orgs/:orgId/phone-numbers', () => {
  it('returns the caller’s numbers keyed, with total and activeCount', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      numberRow({ id: 'num-active', isActiveForOutbound: true }),
      numberRow({ id: 'num-spare' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.numbers).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.activeCount).toBe(1)
  })

  it('returns exactly the fields the client needs, and no others', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([numberRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.numbers[0]).sort()).toEqual([
      'createdAt',
      'e164',
      'id',
      'isActiveForOutbound',
      'status',
      'twilioSid',
    ])
  })

  it('sends createdAt as an ISO string, not a Date', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([numberRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.numbers[0].createdAt).toBe(NOW.toISOString())
  })

  it('keeps twilioSid null while the number is still being bought', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      numberRow({ twilioSid: null, status: 'searching' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.numbers[0].twilioSid).toBeNull()
    expect(res.body.numbers[0].status).toBe('searching')
  })

  it('asks the database for active first, then oldest first', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActiveForOutbound: 'desc' }, { createdAt: 'asc' }],
      }),
    )
  })

  it('answers an empty list with zeroes, not an error', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ numbers: [], total: 0, activeCount: 0 })
  })

  // The schema allows one active number per user. If two ever go true, the
  // count must SHOW it rather than quietly report 1.
  it('reports a count above 1 when the data is broken, instead of hiding it', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      numberRow({ id: 'num-1', isActiveForOutbound: true }),
      numberRow({ id: 'num-2', isActiveForOutbound: true }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.activeCount).toBe(2)
  })
})

// ============================================================
// Org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('GET /api/orgs/:orgId/phone-numbers — org isolation', () => {
  it('401s without auth', async () => {
    const res = await request(app).get(URL_A)

    expect(res.status).toBe(401)
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('200s for an org the caller belongs to', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
  })

  it('404s for an org the caller does not belong to, and reads nothing', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/phone-numbers`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('filters by orgId AND the caller, so a colleague’s number is never returned', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG_A, assignedUserId: 'user-a' } }),
    )
  })

  it('scopes to the org in the PATH, never the caller’s currentOrgId preference', async () => {
    // The caller's stored preference says Org A; the request names Org B, and
    // they are a member of it. The query must follow the path.
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', enabled: true } }))

    await request(app).get(`/api/orgs/${ORG_B}/phone-numbers`).set('Authorization', AUTH)

    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', orgId: ORG_B, isActive: true } }),
    )
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG_B, assignedUserId: 'user-a' } }),
    )
  })
})

// ============================================================
// POST /api/orgs/:orgId/phone-numbers/search
// ============================================================
describe('POST /api/orgs/:orgId/phone-numbers/search', () => {
  it('returns the numbers Twilio offered, keyed, with a total', async () => {
    listNumbersMock.mockResolvedValue([
      availableRow({ e164: '+14155550123', friendly: '(415) 555-0123' }),
      availableRow({ e164: '+14155550124', friendly: '(415) 555-0124' }),
    ])

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ areaCode: '415' })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.numbers).toEqual([
      { e164: '+14155550123', friendly: '(415) 555-0123', priceMonthly: '1.15' },
      { e164: '+14155550124', friendly: '(415) 555-0124', priceMonthly: '1.15' },
    ])
  })

  it('returns exactly the three fields per number, and no others', async () => {
    listNumbersMock.mockResolvedValue([availableRow()])

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(Object.keys(res.body.numbers[0]).sort()).toEqual(['e164', 'friendly', 'priceMonthly'])
  })

  // The price is Twilio's country-level figure for a local number. It is fetched
  // once and stamped on every row, so the row and the quote cannot disagree.
  it('carries the price as the decimal string Twilio quoted, plus its currency', async () => {
    getPriceMock.mockResolvedValue({ amount: '3.00', currency: 'GBP' })
    listNumbersMock.mockResolvedValue([availableRow()])

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ country: 'GB' })

    expect(res.body.numbers[0].priceMonthly).toBe('3.00')
    expect(res.body.priceUnit).toBe('GBP')
    expect(getPriceMock).toHaveBeenCalledWith('GB')
  })

  // Better a visibly missing price than a made-up one: the buy screen can say
  // "price unavailable" and still let someone see which numbers are free.
  it('passes a null price through rather than inventing a figure', async () => {
    getPriceMock.mockResolvedValue({ amount: null, currency: 'USD' })
    listNumbersMock.mockResolvedValue([availableRow()])

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.body.numbers[0].priceMonthly).toBeNull()
  })

  it('defaults to US and a 20-number limit when the body is empty', async () => {
    await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(listNumbersMock).toHaveBeenCalledWith({
      country: 'US',
      areaCode: undefined,
      contains: undefined,
      limit: 20,
    })
  })

  it('uppercases the country, so "us" is not a different search from "US"', async () => {
    await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ country: 'us' })

    expect(listNumbersMock).toHaveBeenCalledWith(expect.objectContaining({ country: 'US' }))
  })

  // A form posts "" for a field nobody touched. That is "no filter", not an error.
  it('treats an empty areaCode as no filter instead of a 400', async () => {
    const res = await request(app)
      .post(SEARCH_A)
      .set('Authorization', AUTH)
      .send({ areaCode: '', contains: '' })

    expect(res.status).toBe(200)
    expect(listNumbersMock).toHaveBeenCalledWith(
      expect.objectContaining({ areaCode: undefined, contains: undefined }),
    )
  })

  it('answers an empty result with zero and an empty list, not an error', async () => {
    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(200)
    expect(res.body.numbers).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

// ============================================================
// POST /search — invalid input
// ============================================================
describe('POST /api/orgs/:orgId/phone-numbers/search — invalid input', () => {
  it('400s on a country that is not two letters, and calls Twilio not at all', async () => {
    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ country: 'USA' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Country must be a two-letter code, like US or CA.')
    expect(listNumbersMock).not.toHaveBeenCalled()
    expect(getPriceMock).not.toHaveBeenCalled()
  })

  it('400s on an area code that is not three digits', async () => {
    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ areaCode: '41' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Area code must be three digits, like 415.')
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  // Twilio applies areaCode to the NANP only. Sent for GB it is ignored, and the
  // caller gets numbers that do not match what they asked for.
  it('400s on an area code outside the US and Canada, rather than ignoring it', async () => {
    const res = await request(app)
      .post(SEARCH_A)
      .set('Authorization', AUTH)
      .send({ country: 'GB', areaCode: '415' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Area code search works for US and Canada numbers only.')
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  it('400s on a contains pattern with characters Twilio does not accept', async () => {
    const res = await request(app)
      .post(SEARCH_A)
      .set('Authorization', AUTH)
      .send({ contains: 'ca$h!!' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Use * to stand for any one character.')
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  it('400s on a limit above the cap, so one request cannot list a thousand numbers', async () => {
    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ limit: 500 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Ask for at most 50 numbers at a time.')
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  it('sends an error message a person can act on, never a raw zod dump', async () => {
    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ country: '1' })

    expect(typeof res.body.error).toBe('string')
    expect(res.body.error).not.toContain('ZodError')
    expect(Object.keys(res.body)).toEqual(['error'])
  })
})

// ============================================================
// POST /search — Twilio failures
// ============================================================
describe('POST /api/orgs/:orgId/phone-numbers/search — Twilio failures', () => {
  it('500s with a non-leaky message when Twilio throws', async () => {
    listNumbersMock.mockRejectedValue(twilioError(503))

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('500s when the pricing call is the one that fails', async () => {
    getPriceMock.mockRejectedValue(new Error('pricing unavailable'))

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('500s, not 200-with-nothing, when Twilio is unconfigured', async () => {
    listNumbersMock.mockRejectedValue(
      new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env'),
    )

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(500)
    // The var names are for the log, never for the caller.
    expect(res.body.error).not.toContain('TWILIO')
  })

  // Twilio answers 404 for a country it does not sell in. That is the caller's
  // mistake, so it reads as a 400 they can fix — not a 500 that blames us.
  it('turns Twilio’s 404 for an unsold country into a 400 naming the country', async () => {
    listNumbersMock.mockRejectedValue(twilioError(404))

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({ country: 'AQ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Twilio does not sell phone numbers in AQ.')
  })
})

// ============================================================
// POST /search — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/phone-numbers/search — org isolation', () => {
  it('401s without auth, and never reaches Twilio', async () => {
    const res = await request(app).post(SEARCH_A).send({})

    expect(res.status).toBe(401)
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  // Membership is checked BEFORE the body is parsed, so a stranger cannot spend
  // this org's Twilio quota — or learn the org exists — with any body at all.
  it('404s for an org the caller does not belong to, and never reaches Twilio', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers/search`)
      .set('Authorization', AUTH)
      .send({ areaCode: '415' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(listNumbersMock).not.toHaveBeenCalled()
    expect(getPriceMock).not.toHaveBeenCalled()
  })

  it('404s for a non-member even when the body is invalid, so 400 cannot map the orgs', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers/search`)
      .set('Authorization', AUTH)
      .send({ country: 'NOPE' })

    expect(res.status).toBe(404)
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(404)
    expect(listNumbersMock).not.toHaveBeenCalled()
  })

  it('checks membership in the org from the PATH, not the caller’s currentOrgId', async () => {
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', enabled: true } }))

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers/search`)
      .set('Authorization', AUTH)
      .send({})

    expect(res.status).toBe(200)
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', orgId: ORG_B, isActive: true } }),
    )
  })
})
