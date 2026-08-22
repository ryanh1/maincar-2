import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
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

const NOW = new Date('2026-08-22T12:00:00.000Z')
const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/reports/run`
const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
}

function authAsMember(): void {
  verifyTokenMock.mockResolvedValue({ uid: 'firebase-a' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'firebase-a', email: 'a@example.com',
    firstName: 'Avery', lastName: 'Admin', roles: ['admin'], enabled: true,
    timeZone: 'America/New_York', currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
  })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['admin'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authAsMember()
  prismaMock.$queryRaw.mockResolvedValue([
    { stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: 3500n },
    { stageId: 'stage-won', stageName: 'Won', amountMinor: 9000n },
  ])
})

describe('POST /api/orgs/:orgId/reports/run', () => {
  it('returns Deal stage sums as exact minor-unit strings', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: CONFIG })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      report: {
        rows: [
          { stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: '3500' },
          { stageId: 'stage-won', stageName: 'Won', amountMinor: '9000' },
        ],
      },
    })
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })
})
