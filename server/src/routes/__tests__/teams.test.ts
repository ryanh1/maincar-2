import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    team: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    teamMember: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
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

const AUTH = 'Bearer fake-token'
const ORG_ID = 'org-a'

function teamRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-a', orgId: ORG_ID, name: 'Revenue', leadUserId: 'user-a', archivedAt: null,
    createdAt: new Date('2026-08-22T00:00:00.000Z'), updatedAt: new Date('2026-08-22T00:00:00.000Z'),
    members: [
      { userId: 'user-a', user: { id: 'user-a', email: 'a@example.com', firstName: 'A', lastName: 'One', title: null } },
      { userId: 'user-b', user: { id: 'user-b', email: 'b@example.com', firstName: 'B', lastName: 'Two', title: null } },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', enabled: true })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    org: { id: ORG_ID, enabled: true },
  })
  prismaMock.$queryRaw.mockResolvedValue([
    { userId: 'user-a' },
    { userId: 'user-b' },
  ])
  prismaMock.team.create.mockResolvedValue(teamRow())
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
})

describe('POST /api/orgs/:orgId/teams', () => {
  it('lets any active member create a team with an active roster lead', async () => {
    const response = await request(app)
      .post(`/api/orgs/${ORG_ID}/teams`)
      .set('Authorization', AUTH)
      .send({ name: 'Revenue', leadUserId: 'user-a', memberUserIds: ['user-a', 'user-b'] })

    expect(response.status).toBe(201)
    expect(response.body.team).toMatchObject({
      id: 'team-a', orgId: ORG_ID, name: 'Revenue', leadUserId: 'user-a', memberUserIds: ['user-a', 'user-b'],
    })
  })
})

describe('GET /api/orgs/:orgId/teams', () => {
  it('returns the requested server page sorted by team name', async () => {
    prismaMock.team.findMany.mockResolvedValue([teamRow({ id: 'team-b', name: 'Customer success' })])
    prismaMock.team.count.mockResolvedValue(3)

    const response = await request(app)
      .get(`/api/orgs/${ORG_ID}/teams?page=2&limit=1&sort=name&dir=desc`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ total: 3, page: 2, limit: 1 })
    expect(response.body.teams).toEqual([expect.objectContaining({ id: 'team-b', name: 'Customer success' })])
    expect(prismaMock.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 1,
      take: 1,
      orderBy: [{ name: 'desc' }, { createdAt: 'asc' }],
    }))
  })
})
