// Route tests for /api/orgs/:orgId/phone-numbers.
//
// The org-isolation block at the bottom proves that a caller from Org A cannot
// read Org B's numbers, that an unauthenticated caller is rejected, and that the
// tenant key really is in the where clause rather than only in the path.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const {
  prismaMock,
  verifyTokenMock,
  listNumbersMock,
  getPriceMock,
  queueProvisionMock,
  queueReleaseMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    phoneNumber: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them. Releasing a
      // number DOES eventually delete its row, but that happens in
      // src/jobs/releaseNumber.ts — no route may delete an org-scoped row.
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    // The release route's row lock. Raw SQL because Prisma cannot express
    // `FOR UPDATE`; the tests read the text back to prove the lock is taken.
    $queryRaw: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  listNumbersMock: vi.fn(),
  getPriceMock: vi.fn(),
  queueProvisionMock: vi.fn(),
  queueReleaseMock: vi.fn(),
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

// The job module, not pg-boss. The buy route's contract with provisioning is one
// function call, so mocking that function is the whole seam — and it is what
// keeps the unit suite from ever reaching a queue, a database, or Twilio.
vi.mock('../../jobs/provisionNumber.js', () => ({
  queueProvisionNumber: queueProvisionMock,
}))

// The release route's contract with the background job is the same single
// function call, mocked for the same reason: the route's job is to mark the row
// and hand it over, and a real queue here would prove nothing about that.
vi.mock('../../jobs/releaseNumber.js', () => ({
  queueReleaseNumber: queueReleaseMock,
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
  // reset, not just re-point: `authAsAdmin` below queues TWO one-shot answers for
  // the assignment route, and a test that consumes only the first leaves the
  // second in the queue. `vi.clearAllMocks()` clears recorded calls but not a
  // pending `mockResolvedValueOnce`, so without this the leftover would answer
  // the NEXT test's membership gate with a row that is not a membership at all.
  prismaMock.membership.findFirst.mockReset()
  // The gate looks the caller's membership up per request; null means "not a member".
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.phoneNumber.findMany.mockResolvedValue([])
  prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow())
  prismaMock.phoneNumber.updateMany.mockResolvedValue({ count: 1 })
  // Runs the callback against the same mock, so the assertions below see the
  // writes the route makes INSIDE the transaction.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  prismaMock.phoneNumber.create.mockResolvedValue(numberRow())
  // The row lock takes no decision of its own — findMany below is what the
  // release route reads. It just has to resolve.
  prismaMock.$queryRaw.mockResolvedValue([])
  listNumbersMock.mockResolvedValue([])
  getPriceMock.mockResolvedValue({ amount: '1.15', currency: 'USD' })
  queueProvisionMock.mockResolvedValue('job-1')
  queueReleaseMock.mockResolvedValue('job-2')
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

// ============================================================
// POST /api/orgs/:orgId/phone-numbers — buy a number
// ============================================================
// The route itself never talks to Twilio: it writes a "searching" row and hands
// the purchase to the job. Every test below is really about one of two things —
// that a bad request never reaches the job (the job spends money), and that a
// good one leaves a row and a job that agree with each other.
const BUY_E164 = '+14155550123'

/** The row the route writes: bought by nobody yet, so no SID and no caller ID. */
function searchingRow(overrides: Record<string, unknown> = {}) {
  return numberRow({
    id: 'num-new',
    e164: BUY_E164,
    twilioSid: null,
    status: 'searching',
    isActiveForOutbound: false,
    ...overrides,
  })
}

describe('POST /api/orgs/:orgId/phone-numbers', () => {
  beforeEach(() => {
    // Nothing owned yet — the ownership lookup finds no row.
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow())
  })

  it('201s with the new number, keyed, searching and not yet a caller ID', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(201)
    expect(res.body.number).toEqual(
      expect.objectContaining({
        id: 'num-new',
        e164: BUY_E164,
        status: 'searching',
        isActiveForOutbound: false,
      }),
    )
  })

  it('returns exactly the fields the list route returns, and no others', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(Object.keys(res.body.number).sort()).toEqual([
      'createdAt',
      'e164',
      'id',
      'isActiveForOutbound',
      'status',
      'twilioSid',
    ])
    expect(res.body.number.twilioSid).toBeNull()
  })

  it('writes the row as searching, in the PATH org, assigned to the caller', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.create).toHaveBeenCalledWith({
      data: {
        orgId: ORG_A,
        assignedUserId: 'user-a',
        e164: BUY_E164,
        status: 'searching',
        isActiveForOutbound: false,
      },
    })
  })

  // The body is caller-controlled. Anything in it that names a tenant or a
  // member is ignored — those come from the path and the verified token.
  it('ignores orgId, assignedUserId and status sent in the body', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({
      e164: BUY_E164,
      orgId: ORG_B,
      assignedUserId: 'someone-else',
      status: 'active',
      isActiveForOutbound: true,
      twilioSid: 'PN-forged',
    })

    expect(prismaMock.phoneNumber.create).toHaveBeenCalledWith({
      data: {
        orgId: ORG_A,
        assignedUserId: 'user-a',
        e164: BUY_E164,
        status: 'searching',
        isActiveForOutbound: false,
      },
    })
  })

  it('queues the provisioning job with the id of the row it just wrote', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(queueProvisionMock).toHaveBeenCalledTimes(1)
    expect(queueProvisionMock).toHaveBeenCalledWith('num-new')
  })

  // Order, not just presence. The job acts only on a row that is already
  // "searching", so a job enqueued ahead of its row would find nothing to buy
  // and settle as a no-op — a purchase lost behind a 201.
  it('writes the row BEFORE it queues the job', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.create.mock.invocationCallOrder[0]!).toBeLessThan(
      queueProvisionMock.mock.invocationCallOrder[0]!,
    )
  })

  // The purchase belongs to the job. If this route ever reached Twilio it would
  // hold the request open on a third party — and charge before the row existed.
  it('never touches Twilio itself', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(listNumbersMock).not.toHaveBeenCalled()
    expect(getPriceMock).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace rather than rejecting a pasted number', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: `  ${BUY_E164} ` })

    expect(prismaMock.phoneNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ e164: BUY_E164 }) }),
    )
  })
})

// ============================================================
// POST / — invalid E.164
// ============================================================
// Everything here must stop before the job. A malformed number that reaches
// Twilio is either a rejection this app could have predicted, or — worse, if it
// happens to be well-formed and wrong — a real number bought by mistake.
describe('POST /api/orgs/:orgId/phone-numbers — invalid e164', () => {
  beforeEach(() => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow())
  })

  /** Every bad shape answers 400 and leaves no row and no job behind. */
  async function expectRejected(body: Record<string, unknown>) {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(body)

    expect(res.status).toBe(400)
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
    return res
  }

  it('400s an empty body, and writes and queues nothing', async () => {
    const res = await expectRejected({})

    expect(res.body.error).toBe('Pick a number to buy, and send it as e164.')
  })

  it('400s a number with no leading plus', async () => {
    const res = await expectRejected({ e164: '14155550123' })

    expect(res.body.error).toContain('E.164')
  })

  it('400s a number with spaces and dashes, instead of quietly reshaping it', async () => {
    // Stripping the punctuation would be friendlier right up until it turned a
    // typo into a different, perfectly valid number that then gets bought.
    await expectRejected({ e164: '+1 (415) 555-0123' })
  })

  it('400s letters dressed up as a number', async () => {
    await expectRejected({ e164: '+1415CALLME' })
  })

  it('400s a number too short to be dialable', async () => {
    await expectRejected({ e164: '+1415' })
  })

  it('400s a number past E.164’s fifteen digits', async () => {
    await expectRejected({ e164: '+1234567890123456' })
  })

  it('400s a country code starting with zero, which no country has', async () => {
    await expectRejected({ e164: '+04155550123' })
  })

  it('400s a number sent as something other than a string', async () => {
    await expectRejected({ e164: 14155550123 })
  })

  it('sends an error a person can act on, never a raw zod dump', async () => {
    const res = await expectRejected({ e164: 'nope' })

    expect(typeof res.body.error).toBe('string')
    expect(res.body.error).not.toContain('ZodError')
    expect(Object.keys(res.body)).toEqual(['error'])
  })
})

// ============================================================
// POST / — a number the org already has
// ============================================================
// "Owned" means a row for this e164 in this org whose status is not "failed".
// Buying one twice rents a second number at the same monthly price forever.
describe('POST /api/orgs/:orgId/phone-numbers — already owned', () => {
  beforeEach(() => {
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow())
  })

  it('409s when a purchase for the same number is already in flight', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(searchingRow({ id: 'num-existing' }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Your organization already has this number. Pick a different one.')
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
  })

  // The org owns the number; a member is only who it is assigned to. So a
  // colleague already holding it counts as owned — and the message says
  // "your organization" without naming the colleague.
  it('409s when a colleague in the same org already holds the number', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      searchingRow({ id: 'num-colleague', assignedUserId: 'user-colleague', status: 'active' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(409)
    expect(res.body.error).not.toContain('user-colleague')
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
  })

  // The where clause is the decision. "failed" is absent on purpose: a failed
  // row is a purchase that never happened, and the person clicking buy again is
  // retrying because of it — blocking would strand them on that number forever.
  it('asks only about this org, this number, and the statuses that mean owned', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_A, e164: BUY_E164, status: { in: ['searching', 'active', 'releasing'] } },
      select: { id: true },
    })
  })

  // The same query, read from the other side: a row left over from a purchase
  // that failed does not match, so the retry goes through and buys.
  it('lets a retry through when the only row for this number failed', async () => {
    // The failed row is filtered out by the status clause, so the lookup that
    // decides this returns nothing.
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(201)
    expect(prismaMock.phoneNumber.create).toHaveBeenCalledTimes(1)
    expect(queueProvisionMock).toHaveBeenCalledWith('num-new')
    expect(
      prismaMock.phoneNumber.findFirst.mock.calls[0]![0].where.status.in,
    ).not.toContain('failed')
  })

  // Another org holding the number is invisible here on purpose: reading across
  // tenants to answer this would break the boundary. Twilio refuses the second
  // sale, and the job writes that refusal down as "failed".
  it('does not consult other orgs — the lookup is scoped to the path org', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: ORG_A }) }),
    )
  })
})

// ============================================================
// POST / — the queue is down
// ============================================================
// The failure worth thinking hardest about. The row is written before the job is
// queued, so an enqueue that throws leaves a "searching" row that nothing will
// ever provision: the list screen spins on it forever, and the ownership check
// above would refuse every retry of that number. It is marked "failed" instead —
// honest, the same status the job writes on a purchase it cannot make, and the
// one status a retry is let through.
describe('POST /api/orgs/:orgId/phone-numbers — the queue is down', () => {
  beforeEach(() => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow())
    queueProvisionMock.mockRejectedValue(new Error('pg-boss is unreachable'))
  })

  it('500s with a non-leaky message rather than a 201 nothing will honour', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(res.body.error).not.toContain('pg-boss')
  })

  it('marks the orphaned row failed, compare-and-set on searching and the org', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 'num-new', orgId: ORG_A, status: 'searching' },
      data: { status: 'failed' },
    })
  })

  // The row is kept, not deleted: the attempt stays visible to anyone reading
  // the table, and "failed" already means "safe to try again".
  it('keeps the row rather than deleting it', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(prismaMock.phoneNumber.delete).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledTimes(1)
  })

  // The database is a likely reason the enqueue failed at all, so the cleanup
  // failing too is expected. The original failure still has to reach the caller.
  it('still 500s when the cleanup write fails as well', async () => {
    prismaMock.phoneNumber.updateMany.mockRejectedValue(new Error('database is gone'))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })
})

// ============================================================
// POST / — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/phone-numbers — org isolation', () => {
  beforeEach(() => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow())
  })

  it('401s without auth, and writes and queues nothing', async () => {
    const res = await request(app).post(URL_A).send({ e164: BUY_E164 })

    expect(res.status).toBe(401)
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads or writes anything', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers`)
      .set('Authorization', AUTH)
      .send({ e164: BUY_E164 })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.phoneNumber.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
  })

  // Membership is checked before the body is parsed, so the two answers cannot
  // be told apart and used to map which orgs exist.
  it('404s a non-member even when the body is invalid, so 400 cannot map the orgs', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers`)
      .set('Authorization', AUTH)
      .send({ e164: 'nonsense' })

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: BUY_E164 })

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
  })

  it('buys into the org from the PATH, never the caller’s currentOrgId preference', async () => {
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', enabled: true } }))
    prismaMock.phoneNumber.create.mockResolvedValue(searchingRow({ orgId: ORG_B }))

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/phone-numbers`)
      .set('Authorization', AUTH)
      .send({ e164: BUY_E164 })

    expect(res.status).toBe(201)
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', orgId: ORG_B, isActive: true } }),
    )
    expect(prismaMock.phoneNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: ORG_B }) }),
    )
  })
})

// ============================================================
// PATCH /api/orgs/:orgId/phone-numbers/:id
// ============================================================
const PATCH_A = `${URL_A}/num-1`

describe('PATCH /api/orgs/:orgId/phone-numbers/:id', () => {
  it('activates the number and returns it keyed, as active', async () => {
    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(200)
    expect(res.body.number.id).toBe('num-1')
    expect(res.body.number.isActiveForOutbound).toBe(true)
  })

  it('returns exactly the fields the list route returns, and no others', async () => {
    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(Object.keys(res.body.number).sort()).toEqual([
      'createdAt',
      'e164',
      'id',
      'isActiveForOutbound',
      'status',
      'twilioSid',
    ])
  })

  // The un-picking is the whole point: one active number per user, so choosing
  // one has to clear the others in the same breath.
  it('clears every other active number of this caller in this org', async () => {
    await request(app).patch(PATCH_A).set('Authorization', AUTH).send({ isActiveForOutbound: true })

    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: {
        orgId: ORG_A,
        assignedUserId: 'user-a',
        isActiveForOutbound: true,
        id: { not: 'num-1' },
      },
      data: { isActiveForOutbound: false },
    })
  })

  it('activates through updateMany carrying the tenant keys, never update-by-id', async () => {
    await request(app).patch(PATCH_A).set('Authorization', AUTH).send({ isActiveForOutbound: true })

    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_A, assignedUserId: 'user-a' },
      data: { isActiveForOutbound: true },
    })
  })

  // Both writes, or neither. A crash between them would otherwise leave the
  // caller with no active number, or with two.
  it('does both writes inside ONE transaction', async () => {
    await request(app).patch(PATCH_A).set('Authorization', AUTH).send({ isActiveForOutbound: true })

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledTimes(2)

    const txOrder = prismaMock.$transaction.mock.invocationCallOrder[0]!
    for (const call of prismaMock.phoneNumber.updateMany.mock.invocationCallOrder) {
      expect(call).toBeGreaterThan(txOrder)
    }
  })

  // Reading inside the transaction is what makes the status check and the write
  // see the same instant.
  it('reads the row inside the transaction, before it writes anything', async () => {
    await request(app).patch(PATCH_A).set('Authorization', AUTH).send({ isActiveForOutbound: true })

    const readOrder = prismaMock.phoneNumber.findFirst.mock.invocationCallOrder[0]!
    expect(readOrder).toBeGreaterThan(prismaMock.$transaction.mock.invocationCallOrder[0]!)
    expect(readOrder).toBeLessThan(prismaMock.phoneNumber.updateMany.mock.invocationCallOrder[0]!)
  })

  // A number the provisioning job lost a race on: gone between the read and the
  // write. Better a 404 than a 200 reporting a change that did not happen.
  it('404s when the activating write turns out to touch no row', async () => {
    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Phone number not found')
  })
})

// ============================================================
// PATCH — a number that is not ready to call from
// ============================================================
describe('PATCH /api/orgs/:orgId/phone-numbers/:id — not provisioned yet', () => {
  it('400s a number still being bought, and names "searching" so the wait makes sense', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      numberRow({ status: 'searching', twilioSid: null }),
    )

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('searching')
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('400s a number whose purchase failed, and names "failed"', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow({ status: 'failed' }))

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('failed')
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('400s a number on its way out, rather than making it the caller ID', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow({ status: 'releasing' }))

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('releasing')
  })
})

// ============================================================
// PATCH — invalid input, and the deliberate answer to `false`
// ============================================================
describe('PATCH /api/orgs/:orgId/phone-numbers/:id — invalid input', () => {
  it('400s an empty body, and writes nothing', async () => {
    const res = await request(app).patch(PATCH_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Send isActiveForOutbound as true or false.')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('400s a string where a boolean belongs, without a raw zod dump', async () => {
    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: 'yes' })

    expect(res.status).toBe(400)
    expect(res.body.error).not.toContain('ZodError')
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  // Deliberate: `false` is refused, not silently ignored. Switching the active
  // number off would leave the caller with no caller ID and no way to dial, and
  // no screen would explain why. The way out of a number is into another one.
  it('400s `false` with a message saying what to do instead, and writes nothing', async () => {
    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: false })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(
      'To stop calling from this number, make a different one active instead. Switching this one off would leave you with no caller ID and no way to place a call.',
    )
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// PATCH — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('PATCH /api/orgs/:orgId/phone-numbers/:id — org isolation', () => {
  it('401s without auth, and writes nothing', async () => {
    const res = await request(app).patch(PATCH_A).send({ isActiveForOutbound: true })

    expect(res.status).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any number', async () => {
    authAs(null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_B}/phone-numbers/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.phoneNumber.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  // A colleague's number is not a 403: saying "forbidden" would confirm the id
  // is real and tell the caller whose it is not.
  it('404s a number that belongs to a colleague, and looks it up scoped to the caller', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(PATCH_A)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Phone number not found')
    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_A, assignedUserId: 'user-a' },
    })
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  // The caller is a real member of Org B; the number lives in Org A. The orgId
  // in the where clause is what makes that a 404 instead of a cross-tenant write.
  it('404s a number that lives in another org, scoping the lookup to the PATH org', async () => {
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', enabled: true } }))
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_B}/phone-numbers/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_B, assignedUserId: 'user-a' },
    })
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('404s a non-member even when the body is invalid, so 400 cannot map the orgs', async () => {
    authAs(null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_B}/phone-numbers/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: 'nope' })

    expect(res.status).toBe(404)
  })
})

// ============================================================
// DELETE /api/orgs/:orgId/phone-numbers/:id — give the number back
// ============================================================
// The route that stops the org paying Twilio. It does not call Twilio itself: it
// moves the row to "releasing" and hands the rest to the background job, so what
// these tests assert is the marking, the refusals, and the hand-off.
const DELETE_A = `${URL_A}/num-1`

/**
 * Puts `rows` behind the release route's one read.
 *
 * The route reads every number the caller holds in one findMany — the target and
 * the ones the fallback check counts — so a test sets up the whole list at once.
 */
function callerHolds(...rows: ReturnType<typeof numberRow>[]): void {
  prismaMock.phoneNumber.findMany.mockResolvedValue(rows)
}

describe('DELETE /api/orgs/:orgId/phone-numbers/:id', () => {
  it('marks the number releasing and queues the release', async () => {
    callerHolds(numberRow({ status: 'active' }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.number).toMatchObject({ id: 'num-1', status: 'releasing' })
    expect(queueReleaseMock).toHaveBeenCalledWith('num-1')
  })

  // updateMany with all three keys, never update by id, and a compare-and-set on
  // the status the route just read.
  it('scopes the write by org and caller, and compare-and-sets on the status', async () => {
    callerHolds(numberRow({ status: 'active' }))

    await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_A, assignedUserId: 'user-a', status: 'active' },
      data: { status: 'releasing', isActiveForOutbound: false },
    })
  })

  // calls.ts picks the caller ID with `WHERE isActiveForOutbound = true` and does
  // not look at the status. A releasing row left switched on would keep placing
  // calls from a number on its way out of the account.
  it('switches the number off as caller ID in the same write', async () => {
    callerHolds(numberRow({ status: 'active', isActiveForOutbound: true }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.phoneNumber.updateMany.mock.calls[0]![0].data.isActiveForOutbound).toBe(false)
    expect(res.body.number.isActiveForOutbound).toBe(false)
  })

  // The whole point of doing this in one transaction with a lock: two releases
  // fired at once must not both read "there is a fallback" and both commit.
  it('locks the caller’s numbers FOR UPDATE before it reads them', async () => {
    callerHolds(numberRow({ status: 'active' }))

    await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect((prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR UPDATE')
  })

  // A failed purchase is a row for a number Twilio never sold us. Clearing it out
  // goes through the same route, so the person has one way to remove a row.
  it('releases a failed row too, so a dead purchase can be cleared', async () => {
    callerHolds(numberRow({ status: 'failed', twilioSid: null }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.phoneNumber.updateMany.mock.calls[0]![0].where.status).toBe('failed')
    expect(queueReleaseMock).toHaveBeenCalledWith('num-1')
  })

  // No route may delete an org-scoped row. The row goes in the job, after Twilio
  // has confirmed — deleting it here would lose the SID and with it any way to
  // ever stop the charge.
  it('never deletes the row itself', async () => {
    callerHolds(numberRow({ status: 'active' }))

    await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(prismaMock.phoneNumber.delete).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.deleteMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/phone-numbers/:id — the refusals', () => {
  // The provisioning job is about to spend money on this row. Deleting it a
  // moment before Twilio answers leaves a rented number with no row behind it.
  it('409s a number that is still being bought, and queues nothing', async () => {
    callerHolds(numberRow({ status: 'searching', twilioSid: null }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      'This number is still being bought. Wait until it is ready, then release it.',
    )
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  // Refused only while there is somewhere to switch TO, and the message names
  // that first step rather than just saying no.
  it('409s the caller ID while another dialable number exists', async () => {
    callerHolds(
      numberRow({ id: 'num-1', status: 'active', isActiveForOutbound: true }),
      numberRow({ id: 'num-2', status: 'active', e164: '+12025550999' }),
    )

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Make a different number your caller ID first, then release this one.')
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  // The other half of the same rule, and the more important half: refusing here
  // would make a rep's last number unreleasable and rent it forever, which is
  // the bug this route exists to fix. The confirm dialog states the cost instead.
  it('allows the caller ID through when it is the only dialable number left', async () => {
    callerHolds(
      numberRow({ id: 'num-1', status: 'active', isActiveForOutbound: true }),
      // Not a fallback: neither of these can carry a call.
      numberRow({ id: 'num-2', status: 'failed', e164: '+12025550888' }),
      numberRow({ id: 'num-3', status: 'searching', e164: '+12025550777' }),
    )

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(queueReleaseMock).toHaveBeenCalledWith('num-1')
  })

  // Asked twice. The answer is the row, not an error — the caller wants this
  // number gone and it is going — but the first job still owns it.
  it('answers a number that is already releasing without queueing a second job', async () => {
    callerHolds(numberRow({ status: 'releasing' }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.number.status).toBe('releasing')
    expect(queueReleaseMock).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/phone-numbers/:id — the queue is down', () => {
  // A "releasing" row with no job behind it is the worst state to walk away
  // from: the number is still rented, and this route refuses a row that is
  // already releasing, so nothing could ever start a second release.
  it('puts the status back and still reports the failure', async () => {
    callerHolds(numberRow({ status: 'active' }))
    queueReleaseMock.mockRejectedValue(new Error('queue is down'))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(500)
    const rollback = prismaMock.phoneNumber.updateMany.mock.calls[1]![0]
    expect(rollback).toEqual({
      where: { id: 'num-1', orgId: ORG_A, status: 'releasing' },
      data: { status: 'active' },
    })
  })

  // A caller ID is picked on purpose, not restored by a rollback.
  it('does not hand the number its caller-ID flag back', async () => {
    callerHolds(numberRow({ status: 'active', isActiveForOutbound: true }))
    queueReleaseMock.mockRejectedValue(new Error('queue is down'))

    await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(prismaMock.phoneNumber.updateMany.mock.calls[1]![0].data).not.toHaveProperty(
      'isActiveForOutbound',
    )
  })

  // The rollback failing must not hide the original error.
  it('still 500s when the rollback fails too', async () => {
    callerHolds(numberRow({ status: 'active' }))
    queueReleaseMock.mockRejectedValue(new Error('queue is down'))
    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database is down too'))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(500)
  })
})

// ============================================================
// DELETE — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('DELETE /api/orgs/:orgId/phone-numbers/:id — org isolation', () => {
  it('401s without auth, and queues nothing', async () => {
    const res = await request(app).delete(DELETE_A)

    expect(res.status).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any number', async () => {
    authAs(null)

    const res = await request(app)
      .delete(`/api/orgs/${ORG_B}/phone-numbers/num-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  // A colleague's number is not a 403: saying "forbidden" would confirm the id is
  // real and tell the caller whose it is not.
  it('404s a number that belongs to a colleague, and reads scoped to the caller', async () => {
    callerHolds()

    const res = await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Phone number not found')
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, assignedUserId: 'user-a' },
    })
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  // The caller is a real member of Org B; the number lives in Org A. The orgId in
  // the read is what makes that a 404 instead of a cross-tenant release.
  it('404s a number that lives in another org, scoping the read to the PATH org', async () => {
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', enabled: true } }))
    callerHolds()

    const res = await request(app)
      .delete(`/api/orgs/${ORG_B}/phone-numbers/num-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_B, assignedUserId: 'user-a' },
    })
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
    expect(queueReleaseMock).not.toHaveBeenCalled()
  })

  // The lock query is raw SQL, so the tenant keys are parameters rather than
  // something Prisma builds. This is what proves they are still both there.
  it('carries the org and the caller into the lock as parameters', async () => {
    callerHolds(numberRow({ status: 'active' }))

    await request(app).delete(DELETE_A).set('Authorization', AUTH)

    expect(prismaMock.$queryRaw.mock.calls[0]!.slice(1)).toEqual([ORG_A, 'user-a'])
  })
})

// ============================================================
// requireAuth — the gate ahead of ALL FIVE routes
// ============================================================
// The blocks above each prove their own route refuses a NON-MEMBER. That is
// requireMembership. This block is the other gate: a caller who never got past
// requireAuth at all. It is a different code path, in a different file, and the
// per-route blocks only ever exercised one corner of it — the missing header.
//
// It runs every case against every route, because the gate is mounted once with
// `router.use(requireAuth)` and a route added below it inherits the gate silently.
// A route that ever slipped ahead of that line would fail here and nowhere else.
const ROUTE_CALLS = [
  {
    name: 'GET /phone-numbers',
    call: (auth: string | null) => {
      const r = request(app).get(URL_A)
      return auth === null ? r : r.set('Authorization', auth)
    },
  },
  {
    name: 'POST /phone-numbers/search',
    call: (auth: string | null) => {
      const r = request(app).post(SEARCH_A)
      return (auth === null ? r : r.set('Authorization', auth)).send({ areaCode: '415' })
    },
  },
  {
    name: 'POST /phone-numbers',
    call: (auth: string | null) => {
      const r = request(app).post(URL_A)
      return (auth === null ? r : r.set('Authorization', auth)).send({ e164: '+14155550123' })
    },
  },
  {
    name: 'PATCH /phone-numbers/:id',
    call: (auth: string | null) => {
      const r = request(app).patch(`${URL_A}/num-1`)
      return (auth === null ? r : r.set('Authorization', auth)).send({ isActiveForOutbound: true })
    },
  },
  {
    name: 'DELETE /phone-numbers/:id',
    call: (auth: string | null) => {
      const r = request(app).delete(`${URL_A}/num-1`)
      return auth === null ? r : r.set('Authorization', auth)
    },
  },
]

/**
 * Nothing happened: no tenant lookup, no row read or written, no Twilio call,
 * and — the two expensive ones — no purchase queued and no release queued.
 *
 * Asserted on every rejection because a status code alone does not prove the
 * work was skipped. A handler that ran and then answered 401 would still have
 * spent this org's Twilio quota, still have queued a number to buy, and still
 * have given away a number the org is using.
 */
function expectNoWorkDone(): void {
  expect(prismaMock.membership.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  expect(prismaMock.phoneNumber.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
  expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  expect(listNumbersMock).not.toHaveBeenCalled()
  expect(getPriceMock).not.toHaveBeenCalled()
  expect(queueProvisionMock).not.toHaveBeenCalled()
  expect(queueReleaseMock).not.toHaveBeenCalled()
}

describe('phone-number routes — requireAuth', () => {
  // An expired or forged token, which Firebase itself refuses. The missing-header
  // case never reaches Firebase, so it cannot stand in for this one.
  it.each(ROUTE_CALLS)('$name 401s a token Firebase rejected', async ({ call }) => {
    verifyTokenMock.mockRejectedValue(
      Object.assign(new Error('Firebase ID token has expired.'), {
        code: 'auth/id-token-expired',
      }),
    )

    const res = await call(AUTH)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not signed in' })
    expectNoWorkDone()
  })

  it.each(ROUTE_CALLS)('$name 401s a scheme that is not Bearer, without asking Firebase', async ({
    call,
  }) => {
    const res = await call('Basic dXNlcjpwYXNzd29yZA==')

    expect(res.status).toBe(401)
    // Never verified: a non-Bearer header cannot carry a Firebase ID token, so
    // handing it to Firebase would be a round trip spent on a certain "no".
    expect(verifyTokenMock).not.toHaveBeenCalled()
    expectNoWorkDone()
  })

  it.each(ROUTE_CALLS)('$name 401s "Bearer" with an empty token', async ({ call }) => {
    const res = await call('Bearer    ')

    expect(res.status).toBe(401)
    expect(verifyTokenMock).not.toHaveBeenCalled()
    expectNoWorkDone()
  })

  // A token that verifies, for an account this database has never seen. Only
  // GET /api/auth/me provisions a User row; every route here must refuse.
  it.each(ROUTE_CALLS)('$name 401s a valid token with no User row behind it', async ({ call }) => {
    prismaMock.user.findUnique.mockResolvedValue(null)

    const res = await call(AUTH)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not signed in' })
    expectNoWorkDone()
  })

  // 403, not 404 and not 401: the caller IS who they say they are, and telling
  // them the account is off is what lets them stop retrying and ask for help.
  it.each(ROUTE_CALLS)('$name 403s a disabled account, and does no work', async ({ call }) => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ enabled: false }))

    const res = await call(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'This account is disabled' })
    expectNoWorkDone()
  })

  // An outage is not a sign-out. A 401 here would tell every signed-in user
  // their session had ended and send them to a sign-in page that is down for
  // exactly the same reason — a blip that reads as a mass sign-out.
  it.each(ROUTE_CALLS)('$name 503s, not 401, when Firebase cannot be reached', async ({ call }) => {
    verifyTokenMock.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'app/network-error' }),
    )

    const res = await call(AUTH)

    expect(res.status).toBe(503)
    expect(res.headers['retry-after']).toBe('5')
    expectNoWorkDone()
  })

  // Three different reasons, one answer. A caller who could tell "no such
  // account" from "bad token" could confirm which emails are registered here.
  it('answers every 401 reason with the same status and the same words', async () => {
    const bodies: unknown[] = []

    const noHeader = await request(app).get(URL_A)
    bodies.push(noHeader.body)

    verifyTokenMock.mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/argument-error' }))
    const badToken = await request(app).get(URL_A).set('Authorization', AUTH)
    bodies.push(badToken.body)

    authAs()
    prismaMock.user.findUnique.mockResolvedValue(null)
    const unknownUser = await request(app).get(URL_A).set('Authorization', AUTH)
    bodies.push(unknownUser.body)

    expect([noHeader.status, badToken.status, unknownUser.status]).toEqual([401, 401, 401])
    expect(bodies).toEqual([
      { error: 'Not signed in' },
      { error: 'Not signed in' },
      { error: 'Not signed in' },
    ])
  })
})

// ============================================================
// The three body routes — a request that carries no body at all
// ============================================================
// `express.json()` leaves `req.body` UNDEFINED when the request has no JSON
// content type, which is what a hand-rolled curl or a client that forgot its
// headers sends. Each route writes `req.body ?? {}` for exactly this. Without
// the fallback, zod is handed `undefined` and the caller gets a 500 for what is
// really a 400 they can fix.
describe('phone-number routes — a request with no body at all', () => {
  it('POST /search treats a bodyless request as the default search, not a crash', async () => {
    listNumbersMock.mockResolvedValue([availableRow()])

    const res = await request(app).post(SEARCH_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // Every field is optional with a default, so "no body" is a valid US search.
    expect(listNumbersMock).toHaveBeenCalledWith({
      country: 'US',
      areaCode: undefined,
      contains: undefined,
      limit: 20,
    })
  })

  it('POST / 400s a bodyless purchase with the message that names E.164, not a 500', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/e164/i)
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled()
    expect(queueProvisionMock).not.toHaveBeenCalled()
  })

  it('PATCH /:id 400s a bodyless activation with the message that names the field', async () => {
    const res = await request(app).patch(`${URL_A}/num-1`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Send isActiveForOutbound as true or false.')
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// PATCH /:id — a failure that is NOT about the number
// ============================================================
// The route turns two named errors into 404 and 400. Everything else has to
// reach wrapRoute untouched. This is the branch that keeps that true: a database
// that fell over mid-transaction must not be reported to the user as "your
// number is gone", because they would go looking for a number that is still
// there and, worse, buy a replacement.
describe('PATCH /api/orgs/:orgId/phone-numbers/:id — the transaction fails for another reason', () => {
  it('500s, never 404, when the transaction throws something it does not recognise', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('deadlock detected'))

    const res = await request(app)
      .patch(`${URL_A}/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('does not leak the database error text to the caller', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Error('relation "PhoneNumber" does not exist at character 42'),
    )

    const res = await request(app)
      .patch(`${URL_A}/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(JSON.stringify(res.body)).not.toMatch(/relation|character 42/)
  })
})

// ============================================================
// The four routes and the job agree on what a status MEANS
// ============================================================
// Each route was built and tested on its own, so each one's tests pin only its
// own half of the contract. What no single-route test can catch is the two
// halves drifting apart — POST writing a status the job does not act on, or the
// job settling on one PATCH will not accept. Every case below is a sentence one
// route SAYS and another route or the job has to BELIEVE.
//
// The vocabulary is the one documented on PhoneNumber.status in schema.prisma:
// "searching", "active", "releasing", "failed".
/**
 * The statuses the buy route treats as "this org already has it".
 *
 * Not imported — the route does not export it. It is read back OUT of the query
 * the route makes in the first test below, so this constant cannot quietly
 * disagree with the route it describes.
 */
const OWNED_STATUSES_FROM_ROUTE = ['searching', 'active', 'releasing']

describe('phone-number routes — the status vocabulary is shared', () => {
  // POST writes "searching"; the provisioning job acts on "searching" and on
  // nothing else. If POST ever wrote a different word, the job would read the
  // row as already settled and the purchase would vanish behind a 201.
  it('POST writes the one status the provisioning job will act on', async () => {
    // Nothing owned yet, so the purchase goes through to the write.
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: '+14155550123' })

    const written = prismaMock.phoneNumber.create.mock.calls[0]![0].data.status
    expect(written).toBe('searching')
    // The route's own ownership query, read back: this is what pins the constant
    // above to the route rather than to a copy of it that can drift.
    expect(prismaMock.phoneNumber.findFirst.mock.calls[0]![0].where.status.in).toEqual(
      OWNED_STATUSES_FROM_ROUTE,
    )
  })

  // The status POST writes is one the ownership check counts as owned, so a
  // second click while the first purchase is still in flight is a 409 rather
  // than a second number rented at the same monthly price.
  it('a row POST just wrote blocks a second purchase of the same number', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue({ id: 'num-inflight' })

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: '+14155550123' })

    expect(res.status).toBe(409)
    const asked = prismaMock.phoneNumber.findFirst.mock.calls[0]![0].where.status.in
    expect(asked).toContain('searching')
  })

  // "failed" is the one status a retry is let through, and it is the status BOTH
  // failure paths write — the job when Twilio refuses, and the buy route when the
  // queue is down. If either wrote something else, the number would be
  // permanently unbuyable by this org with no way for the user to tell why.
  it('the status the buy route writes when the queue is down is one a retry can get past', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    queueProvisionMock.mockRejectedValue(new Error('queue is down'))

    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: '+14155550123' })

    const rollback = prismaMock.phoneNumber.updateMany.mock.calls[0]![0]
    expect(rollback.data.status).toBe('failed')
    expect(OWNED_STATUSES_FROM_ROUTE).not.toContain('failed')
  })

  // The other half of the same sentence, read from PATCH: every status that is
  // not "active" is refused, and the refusal NAMES the status so a person
  // waiting on provisioning learns why rather than being told "no" twice.
  it.each(['searching', 'releasing', 'failed'])(
    'PATCH refuses a %s number and names the status back',
    async (status) => {
      prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow({ status }))

      const res = await request(app)
        .patch(`${URL_A}/num-1`)
        .set('Authorization', AUTH)
        .send({ isActiveForOutbound: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain(status)
      expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
    },
  )

  // And the status the job settles a bought number on is the one — the only one
  // — PATCH will make a caller ID. The job writing anything else would leave a
  // number the org has paid for and can never dial from.
  it('PATCH accepts exactly the status the provisioning job writes on success', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow({ status: 'active' }))

    const res = await request(app)
      .patch(`${URL_A}/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(res.status).toBe(200)
    expect(res.body.number.isActiveForOutbound).toBe(true)
  })

  // No route may invent a fifth word. The list route hands whatever is stored
  // straight through, so a status outside the documented four could only have
  // come from a writer, and every writer is pinned above.
  it('every status these routes write is one schema.prisma documents', async () => {
    const documented = ['searching', 'active', 'releasing', 'failed']

    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: '+14155550123' })
    expect(documented).toContain(prismaMock.phoneNumber.create.mock.calls[0]![0].data.status)

    vi.clearAllMocks()
    authAs()
    prismaMock.phoneNumber.create.mockResolvedValue(numberRow({ id: 'num-new' }))
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    queueProvisionMock.mockRejectedValue(new Error('queue is down'))
    await request(app).post(URL_A).set('Authorization', AUTH).send({ e164: '+14155550123' })
    expect(documented).toContain(prismaMock.phoneNumber.updateMany.mock.calls[0]![0].data.status)
  })
})

// ============================================================
// mapPhoneNumberToApi — one guard for every route that returns a number
// ============================================================
// Three routes hand a PhoneNumber row to the same mapper. The per-route "exactly
// these fields" tests each assert a literal list, so all three would have to be
// edited to let a new column through — but they compare against a hard-coded
// list, which means a column ADDED to the schema and then added to the mapper
// passes all three the moment someone updates the lists.
//
// This asserts from the other direction: every key the DATABASE ROW carries that
// is not on the allowlist must be absent from the response. A new sensitive
// column on PhoneNumber is caught here without anyone remembering to come back.
const API_FIELDS = ['id', 'e164', 'twilioSid', 'status', 'isActiveForOutbound', 'createdAt']

describe('mapPhoneNumberToApi — what never reaches the client', () => {
  it('drops every row column that is not on the API allowlist', async () => {
    const row = numberRow()
    prismaMock.phoneNumber.findMany.mockResolvedValue([row])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    const leaked = Object.keys(row).filter(
      (key) => !API_FIELDS.includes(key) && key in res.body.numbers[0],
    )
    expect(leaked).toEqual([])
  })

  // Named rather than left to the loop above, because these two are the tenant
  // key and the member key: the ones whose leak would matter most and the ones
  // the mapper's comment promises are absent.
  it.each(['orgId', 'assignedUserId'])('never sends %s, from any route', async (field) => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([numberRow()])
    const list = await request(app).get(URL_A).set('Authorization', AUTH)

    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    const bought = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ e164: '+14155550123' })

    prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow())
    const patched = await request(app)
      .patch(`${URL_A}/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    expect(list.body.numbers[0]).not.toHaveProperty(field)
    expect(bought.body.number).not.toHaveProperty(field)
    expect(patched.body.number).not.toHaveProperty(field)
  })

  // updatedAt is on the row and is deliberately not sent. It is not a secret,
  // but a field the client never asked for is a field a client can start relying
  // on, and this route promises a fixed shape.
  it('sends the same six keys from all three routes that return a number', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([numberRow()])
    const list = await request(app).get(URL_A).set('Authorization', AUTH)

    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)
    const bought = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ e164: '+14155550123' })

    prismaMock.phoneNumber.findFirst.mockResolvedValue(numberRow())
    const patched = await request(app)
      .patch(`${URL_A}/num-1`)
      .set('Authorization', AUTH)
      .send({ isActiveForOutbound: true })

    const expected = [...API_FIELDS].sort()
    expect(Object.keys(list.body.numbers[0]).sort()).toEqual(expected)
    expect(Object.keys(bought.body.number).sort()).toEqual(expected)
    expect(Object.keys(patched.body.number).sort()).toEqual(expected)
  })
})

// ============================================================
// MAI-197 — the org-wide view and who holds a number
// ============================================================
// Everything above answers "which numbers are MINE". This block answers the two
// questions an admin could not ask at all before: which numbers is the org
// paying for, and who has them.

/** The holder's identity as the admin table shows it — name AND email. */
function assigneeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-b',
    firstName: 'Bee',
    lastName: 'Ta',
    email: 'b@orga.com',
    ...overrides,
  }
}

/** A row as the admin list reads it: the number, with its holder joined on. */
function orgNumberRow(overrides: Record<string, unknown> = {}) {
  const row = numberRow(overrides)
  return {
    ...row,
    assignedUser: row.assignedUserId === null ? null : assigneeRow({ id: row.assignedUserId }),
    ...overrides,
  }
}

/**
 * Signs an ADMIN in.
 *
 * The assignment route reads `membership.findFirst` TWICE — the caller's own
 * gate, then the seat of the person being handed the number — so the two answers
 * are QUEUED in that order. One `mockResolvedValue` would answer both questions
 * with the caller's own row, and the org-boundary check would pass on a user who
 * is not in the org at all.
 */
function authAsAdmin(
  caller: ReturnType<typeof membershipRow> | null = membershipRow({ roles: ['admin'] }),
  target: { user: ReturnType<typeof assigneeRow> } | null = { user: assigneeRow() },
): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockReset()
  prismaMock.membership.findFirst.mockResolvedValueOnce(caller)
  prismaMock.membership.findFirst.mockResolvedValueOnce(target)
  prismaMock.membership.findFirst.mockResolvedValue(null)
}

const ALL_A = `${URL_A}/all`
const ASSIGN_A = `${URL_A}/num-1/assignment`
const NOT_A_MEMBER_ERROR = 'Pick someone who is in this organization.'
const ASSIGNEE_ERROR = 'Pick a member to give this number to, or send null to take it back.'

describe('GET /api/orgs/:orgId/phone-numbers/all', () => {
  it('returns every number in the org with its holder, keyed, with the totals', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      orgNumberRow({ id: 'num-mine', assignedUserId: 'user-a' }),
      orgNumberRow({ id: 'num-theirs', assignedUserId: 'user-b' }),
    ])

    const res = await request(app).get(ALL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.numbers).toHaveLength(2)
    expect(res.body.total).toBe(2)
    // The whole point: a colleague's number is here, with a name on it.
    expect(res.body.numbers[1].assignedUser.email).toBe('b@orga.com')
    expect(res.body.numbers[1].assignedUser.firstName).toBe('Bee')
  })

  it('sends a number nobody holds as assignedUser null, and counts it', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      orgNumberRow({ id: 'num-held', assignedUserId: 'user-b' }),
      orgNumberRow({ id: 'num-spare', assignedUserId: null }),
    ])

    const res = await request(app).get(ALL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // null, never absent: "nobody has it" is an answer, not a missing lookup.
    expect(res.body.numbers[1].assignedUser).toBeNull()
    expect(res.body.unassignedCount).toBe(1)
  })

  // The one clause that separates this route from the per-user list. Filtering
  // on the caller here would make the admin view a second copy of "my numbers".
  it('filters by orgId and deliberately NOT by the caller', async () => {
    authAsAdmin()

    await request(app).get(ALL_A).set('Authorization', AUTH)

    const args = prismaMock.phoneNumber.findMany.mock.calls[0]![0]
    expect(args.where).toEqual({ orgId: ORG_A })
    expect(args.where).not.toHaveProperty('assignedUserId')
    // Newest first: an admin reading an inventory is checking recent buys.
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }])
  })

  it('refuses a non-admin member with 403, and reads nothing', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app).get(ALL_A).set('Authorization', AUTH)

    // 403, not 404: the rep can see the org perfectly well. They may not read
    // the whole inventory.
    expect(res.status).toBe(403)
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('answers a caller outside the org with 404, not 403', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/phone-numbers/all`).set('Authorization', AUTH)

    // 403 would confirm Org B is real.
    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller before any query', async () => {
    const res = await request(app).get(ALL_A)

    expect(res.status).toBe(401)
    expect(prismaMock.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it('sends the per-user fields plus assignedUser, and no tenant keys', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findMany.mockResolvedValue([orgNumberRow()])

    const res = await request(app).get(ALL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.numbers[0]).sort()).toEqual([
      'assignedUser',
      'createdAt',
      'e164',
      'id',
      'isActiveForOutbound',
      'status',
      'twilioSid',
    ])
    // The holder travels inside `assignedUser`, so the flat tenant/member keys
    // still have no business on the row.
    expect(res.body.numbers[0]).not.toHaveProperty('orgId')
    expect(res.body.numbers[0]).not.toHaveProperty('assignedUserId')
  })

  it('sends only the four holder fields the table shows', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findMany.mockResolvedValue([orgNumberRow()])

    const res = await request(app).get(ALL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.numbers[0].assignedUser).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
    ])
    // And the join asks Postgres for exactly those, so a new User column cannot
    // arrive on this row by accident.
    const include = prismaMock.phoneNumber.findMany.mock.calls[0]![0].include
    expect(include.assignedUser.select).toEqual({
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    })
  })
})

describe('PATCH /api/orgs/:orgId/phone-numbers/:id/assignment', () => {
  it('gives a number nobody holds to a member', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: null, assignedUser: null }),
    )

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(200)
    expect(res.body.number.assignedUser.id).toBe('user-b')
    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_A },
      data: { assignedUserId: 'user-b', isActiveForOutbound: false },
    })
  })

  // The invariant MAI-197 names: reassignment cannot leave one user with two
  // active outbound numbers. The flag meant "this is the OLD holder's caller
  // ID", so carrying it across is exactly how the second one would appear.
  it('clears the caller-ID flag when a HELD number changes hands', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: 'user-a', isActiveForOutbound: true }),
    )

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(200)
    expect(res.body.number.isActiveForOutbound).toBe(false)
    expect(prismaMock.phoneNumber.updateMany.mock.calls[0]![0].data.isActiveForOutbound).toBe(false)
  })

  it('takes a number back with null, clearing the holder and the caller ID', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: 'user-a', isActiveForOutbound: true }),
    )

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: null })

    expect(res.status).toBe(200)
    expect(res.body.number.assignedUser).toBeNull()
    expect(res.body.number.isActiveForOutbound).toBe(false)
    expect(prismaMock.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 'num-1', orgId: ORG_A },
      data: { assignedUserId: null, isActiveForOutbound: false },
    })
    // Nobody to check a seat for, so no membership lookup is made for the target.
    expect(prismaMock.membership.findFirst).toHaveBeenCalledTimes(1)
  })

  // A no-op has to be a no-op. The write clears the caller ID, so re-submitting
  // the holder a number already has would switch that person's line off.
  it('writes NOTHING when the holder is already the one asked for', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: 'user-b', isActiveForOutbound: true }),
    )

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(200)
    // The caller ID survived, which is the whole reason this branch exists.
    expect(res.body.number.isActiveForOutbound).toBe(true)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('treats an already-unassigned number asked to be unassigned as the same no-op', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: null, assignedUser: null }),
    )

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: null })

    expect(res.status).toBe(200)
    expect(res.body.number.assignedUser).toBeNull()
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  // The org boundary, applied to a value that came straight off the body.
  it('refuses a user who holds no active seat in this org, and writes nothing', async () => {
    authAsAdmin(membershipRow({ roles: ['admin'] }), null)
    prismaMock.phoneNumber.findFirst.mockResolvedValue(orgNumberRow({ assignedUserId: 'user-a' }))

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-in-org-b' })

    // 404 and it names nobody: an admin must not learn whether that account exists.
    expect(res.status).toBe(404)
    expect(res.body.error).toBe(NOT_A_MEMBER_ERROR)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('looks the new holder up scoped to this org and to an ACTIVE seat', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(orgNumberRow({ assignedUserId: 'user-a' }))

    await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    // A removed member's row is isActive:false, so offboarding takes effect here
    // too: their seat is gone and no number can be handed to them.
    expect(prismaMock.membership.findFirst.mock.calls[1]![0].where).toEqual({
      userId: 'user-b',
      orgId: ORG_A,
      isActive: true,
    })
  })

  it('refuses a non-admin member with 403, and writes nothing', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(403)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
    // Refused before the body was even read, so no number was looked up either.
    expect(prismaMock.phoneNumber.findFirst).not.toHaveBeenCalled()
  })

  it('answers an admin of another org with 404, and writes nothing', async () => {
    authAs(null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_B}/phone-numbers/num-1/assignment`)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(404)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller before any query', async () => {
    const res = await request(app).patch(ASSIGN_A).send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(401)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  it('404s when the number is not in this org', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Phone number not found')
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  // The row can vanish between the read and the write. The scoped updateMany
  // then touches nothing, and `count === 0` is what turns that into a 404 rather
  // than a silent success.
  it('404s when the scoped write matches no row', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(orgNumberRow({ assignedUserId: 'user-a' }))
    prismaMock.phoneNumber.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Phone number not found')
  })

  it.each([
    ['a missing key', {}],
    ['a number', { assignedUserId: 7 }],
    ['an empty string', { assignedUserId: '' }],
    ['blank space', { assignedUserId: '   ' }],
    ['an array', { assignedUserId: ['user-b'] }],
  ])('refuses %s with one actionable message', async (_label, body) => {
    authAsAdmin()

    const res = await request(app).patch(ASSIGN_A).set('Authorization', AUTH).send(body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(ASSIGNEE_ERROR)
    expect(prismaMock.phoneNumber.updateMany).not.toHaveBeenCalled()
  })

  // Whatever the input, this route can only ever turn the flag OFF. That is what
  // makes "at most one active number per user" hold without a count or a lock:
  // there is no path here that creates a second active row.
  it.each([null, 'user-b'])('never turns the caller-ID flag ON (holder %s)', async (holder) => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(
      orgNumberRow({ assignedUserId: 'user-a', isActiveForOutbound: false }),
    )

    await request(app).patch(ASSIGN_A).set('Authorization', AUTH).send({ assignedUserId: holder })

    for (const call of prismaMock.phoneNumber.updateMany.mock.calls) {
      expect(call[0].data.isActiveForOutbound).toBe(false)
    }
  })

  it('runs the read and the write inside ONE transaction', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(orgNumberRow({ assignedUserId: 'user-a' }))

    await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    // The current holder decides whether this is a no-op, so the read and the
    // write have to see the same instant.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const txOrder = prismaMock.$transaction.mock.invocationCallOrder[0]!
    expect(prismaMock.phoneNumber.findFirst.mock.invocationCallOrder[0]!).toBeGreaterThan(txOrder)
    expect(prismaMock.phoneNumber.updateMany.mock.invocationCallOrder[0]!).toBeGreaterThan(txOrder)
  })

  it('never writes with update() or delete() by id', async () => {
    authAsAdmin()
    prismaMock.phoneNumber.findFirst.mockResolvedValue(orgNumberRow({ assignedUserId: 'user-a' }))

    await request(app)
      .patch(ASSIGN_A)
      .set('Authorization', AUTH)
      .send({ assignedUserId: 'user-b' })

    expect(prismaMock.phoneNumber.delete).not.toHaveBeenCalled()
    expect(prismaMock.phoneNumber.deleteMany).not.toHaveBeenCalled()
  })
})
