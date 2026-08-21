// Route tests for /api/orgs/:orgId/phone-numbers.
//
// The org-isolation block at the bottom is the mandatory one
// (.claude/rules/testing.md): the route proves that a caller from Org A cannot
// read Org B's numbers, that an unauthenticated caller is rejected, and that the
// tenant key really is in the where clause rather than only in the path.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    phoneNumber: { findMany: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/phone-numbers`

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
})

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
      expect.objectContaining({ where: { userId: 'user-a', orgId: ORG_B } }),
    )
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG_B, assignedUserId: 'user-a' } }),
    )
  })
})
