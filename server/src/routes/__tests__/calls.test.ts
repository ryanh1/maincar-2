// Route tests for POST /api/orgs/:orgId/calls.
//
// The org-isolation block at the bottom proves an unauthenticated caller is
// rejected and a non-member is answered 404 before any row is read. The rest
// proves the contract: E.164 validation, the double-call guard, that the caller
// ID and org come from the path and the locked number rather than the body, and
// that a Twilio failure does not leave a phantom "queued" row behind.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock, initiateCallMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    call: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  initiateCallMock: vi.fn(),
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
  initiateOutboundCall: initiateCallMock,
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/calls`

const VALID_BODY = { toE164: '+13035550199', recordingConsent: 'granted' }

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

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    orgId: ORG_A,
    userId: 'user-a',
    fromE164: '+12025550123',
    toE164: '+13035550199',
    direction: 'outbound',
    status: 'queued',
    twilioCallSid: null,
    recordingConsent: 'granted',
    recordingEnabled: null,
    recordingUrl: null,
    transcriptStatus: 'pending',
    transcript: null,
    durationS: null,
    startedAt: null,
    endedAt: null,
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
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  // A locked active number is the default; the no-active-number test overrides
  // this to an empty result.
  prismaMock.$queryRaw.mockResolvedValue([{ id: 'num-1', e164: '+12025550123' }])
  prismaMock.call.findFirst.mockResolvedValue(null)
  prismaMock.call.findMany.mockResolvedValue([callRow()])
  prismaMock.call.count.mockResolvedValue(1)
  prismaMock.call.create.mockResolvedValue(callRow())
  prismaMock.call.updateMany.mockResolvedValue({ count: 1 })
  // Runs the callback against the same mock, so the assertions below see the
  // reads and writes the route makes INSIDE the transaction.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  initiateCallMock.mockResolvedValue({ sid: 'CA123', status: 'queued' })
})

// ============================================================
// GET — list, paginate, sort, search
// ============================================================
describe('GET /api/orgs/:orgId/calls', () => {
  it('returns the org’s calls with the pagination envelope', async () => {
    prismaMock.call.findMany.mockResolvedValue([callRow({ id: 'c1' }), callRow({ id: 'c2' })])
    prismaMock.call.count.mockResolvedValue(2)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.calls.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2'])
    expect(res.body.total).toBe(2)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
  })

  it('scopes both the count and the page to the org in the path', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    expect(prismaMock.call.count).toHaveBeenCalledWith({ where: { orgId: ORG_A } })
    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A })
  })

  it('returns the history fields, including duration and the timestamps', async () => {
    prismaMock.call.findMany.mockResolvedValue([
      callRow({ durationS: 42, startedAt: NOW, endedAt: NOW }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.calls[0]).sort()).toEqual([
      'createdAt',
      'direction',
      'durationS',
      'endedAt',
      'fromE164',
      'id',
      'recordingConsent',
      'startedAt',
      'status',
      'toE164',
      'twilioCallSid',
    ])
    expect(res.body.calls[0].durationS).toBe(42)
    expect(res.body.calls[0].startedAt).toBe(NOW.toISOString())
  })

  it('defaults to page 1, limit 25, newest first', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    const args = prismaMock.call.findMany.mock.calls[0][0]
    expect(args.skip).toBe(0)
    expect(args.take).toBe(25)
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }])
  })

  it('turns page and limit into skip and take', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)

    const args = prismaMock.call.findMany.mock.calls[0][0]
    expect(args.skip).toBe(20)
    expect(args.take).toBe(10)
    expect(prismaMock.call.count).toHaveBeenCalledWith({ where: { orgId: ORG_A } })
  })

  it('clamps limit to the 100 ceiling', async () => {
    const res = await request(app).get(`${URL_A}?limit=500`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('at most 100')
  })

  it('400s a limit below 1 and a page below 1', async () => {
    const low = await request(app).get(`${URL_A}?limit=0`).set('Authorization', AUTH)
    expect(low.status).toBe(400)
    const zeroPage = await request(app).get(`${URL_A}?page=0`).set('Authorization', AUTH)
    expect(zeroPage.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it('searches the destination number by the digits in q', async () => {
    await request(app).get(`${URL_A}?q=201`).set('Authorization', AUTH)

    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      toE164: { contains: '201' },
    })
    expect(prismaMock.call.count).toHaveBeenCalledWith({
      where: { orgId: ORG_A, toE164: { contains: '201' } },
    })
  })

  it('treats a blank q as no filter', async () => {
    await request(app).get(`${URL_A}?q=`).set('Authorization', AUTH)

    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A })
  })

  it('400s a q that is not phone-number digits', async () => {
    const res = await request(app).get(`${URL_A}?q=abc`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it.each([
    ['createdAt', 'asc'],
    ['toE164', 'desc'],
    ['status', 'asc'],
    ['durationS', 'desc'],
  ])('sorts by %s %s', async (sort, dir) => {
    await request(app).get(`${URL_A}?sort=${sort}&dir=${dir}`).set('Authorization', AUTH)

    const orderBy = prismaMock.call.findMany.mock.calls[0][0].orderBy
    // createdAt is its own tie-break, so it orders by one key; the others carry a
    // createdAt tie-break beneath the chosen column.
    if (sort === 'createdAt') {
      expect(orderBy).toEqual([{ createdAt: dir }])
    } else {
      expect(orderBy).toEqual([{ [sort]: dir }, { createdAt: 'desc' }])
    }
  })

  it('400s an unknown sort column, and reads nothing', async () => {
    const res = await request(app).get(`${URL_A}?sort=userId`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it('400s an unknown sort direction', async () => {
    const res = await request(app).get(`${URL_A}?dir=sideways`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
  })

  it('returns an empty page and a zero total when the org has no calls', async () => {
    prismaMock.call.findMany.mockResolvedValue([])
    prismaMock.call.count.mockResolvedValue(0)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.calls).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
  })
})

// ============================================================
// GET — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('GET /api/orgs/:orgId/calls — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).get(URL_A)

    expect(res.status).toBe(401)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
    expect(prismaMock.call.count).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any call', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/calls`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
    expect(prismaMock.call.count).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — happy path
// ============================================================
describe('POST /api/orgs/:orgId/calls', () => {
  it('creates a queued call, dials, and returns the call with its SID', async () => {
    prismaMock.call.create.mockResolvedValue(callRow({ id: 'call-1', status: 'queued' }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.call.status).toBe('queued')
    expect(res.body.call.direction).toBe('outbound')
    expect(res.body.call.fromE164).toBe('+12025550123')
    expect(res.body.call.toE164).toBe('+13035550199')
    expect(res.body.call.twilioCallSid).toBe('CA123')

    // Dialed through the injected wrapper, with the locked number as caller ID.
    expect(initiateCallMock).toHaveBeenCalledTimes(1)
    expect(initiateCallMock).toHaveBeenCalledWith({
      to: '+13035550199',
      from: '+12025550123',
      callId: 'call-1',
    })
  })

  it('returns exactly the fields the client needs, and no others', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(Object.keys(res.body.call).sort()).toEqual([
      'createdAt',
      'direction',
      'fromE164',
      'id',
      'recordingConsent',
      'status',
      'toE164',
      'twilioCallSid',
    ])
  })

  it('writes the row with the org from the path and the caller from the token, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      // A body that lies about who and where. None of it must reach the write.
      .send({ ...VALID_BODY, orgId: ORG_B, userId: 'someone-else', fromE164: '+19995550000' })

    expect(prismaMock.call.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      orgId: ORG_A,
      userId: 'user-a',
      fromE164: '+12025550123',
      toE164: '+13035550199',
      direction: 'outbound',
      status: 'queued',
      recordingConsent: 'granted',
    })
  })

  it('locks the caller’s active number FOR UPDATE before it counts calls in flight', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect((prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR UPDATE')
    // The lock is taken inside the transaction, before the create.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const lockOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0]!
    const createOrder = prismaMock.call.create.mock.invocationCallOrder[0]!
    expect(lockOrder).toBeLessThan(createOrder)
  })

  it('stores the SID with an org-scoped updateMany, never update-by-id', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.call.update).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_A },
      data: { twilioCallSid: 'CA123' },
    })
  })
})

// ============================================================
// POST — invalid input
// ============================================================
describe('POST /api/orgs/:orgId/calls — invalid input', () => {
  it('400s a missing toE164, and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordingConsent: 'granted' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Enter a number to call, and send it as toE164.')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('400s a number that is not E.164, without a raw zod dump', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '3035550199', recordingConsent: 'granted' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('E.164')
    expect(res.body.error).not.toContain('ZodError')
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('400s a missing recordingConsent, and dials nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '+13035550199' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Send recordingConsent as "granted" or "declined".')
    expect(initiateCallMock).not.toHaveBeenCalled()
  })

  it('400s an unrecognized recordingConsent value', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '+13035550199', recordingConsent: 'maybe' })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('400s when the caller has no active number, and dials nothing', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(
      'Activate a phone number for outbound calling before you place a call.',
    )
    expect(prismaMock.call.create).not.toHaveBeenCalled()
    expect(initiateCallMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — the double-call guard
// ============================================================
describe('POST /api/orgs/:orgId/calls — double-call guard', () => {
  it('409s when a call to the same number is already in flight, and creates no second row', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({ id: 'call-inflight', status: 'ringing' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already have a call')
    // The call already up is handed back so the client can adopt it.
    expect(res.body.call.id).toBe('call-inflight')
    expect(prismaMock.call.create).not.toHaveBeenCalled()
    expect(initiateCallMock).not.toHaveBeenCalled()
  })

  it('scopes the in-flight check to this user, this org, this number, and the live statuses', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({
      where: {
        orgId: ORG_A,
        userId: 'user-a',
        toE164: '+13035550199',
        status: { in: ['queued', 'ringing', 'in-progress'] },
      },
    })
  })
})

// ============================================================
// POST — a Twilio failure must not strand a queued row
// ============================================================
describe('POST /api/orgs/:orgId/calls — Twilio failure', () => {
  it('marks the row failed and 500s when Twilio will not place the call', async () => {
    initiateCallMock.mockRejectedValue(new Error('Twilio is down'))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(500)
    // Compare-and-set on "queued", scoped by org, so it cannot drag a settled row.
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_A, status: 'queued' },
      data: { status: 'failed' },
    })
  })
})

// ============================================================
// POST — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/calls — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).post(URL_A).send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any number', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/calls`)
      .set('Authorization', AUTH)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
