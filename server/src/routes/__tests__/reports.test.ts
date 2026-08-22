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
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

const VIEWER_DAY_CONFIG = {
  ...CONFIG,
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'createdAt', grain: 'day' },
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

  it('uses an active subject member zone instead of the viewer zone', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce({
        id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['admin'], isActive: true,
        createdAt: NOW, updatedAt: NOW,
        org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
      })
      .mockResolvedValueOnce({ user: { timeZone: 'Asia/Kolkata' } })

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({
        config: {
          ...VIEWER_DAY_CONFIG,
          timeZone: { mode: 'subject', subjectUserId: 'user-subject' },
        },
      })

    expect(response.status).toBe(200)
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual(['Asia/Kolkata', ORG_ID])
  })

  it('blocks a viewer-bucketed report when the viewer has no saved zone', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-a', firebaseUid: 'firebase-a', email: 'a@example.com',
      firstName: 'Avery', lastName: 'Admin', roles: ['admin'], enabled: true,
      timeZone: null, currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
    })

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: VIEWER_DAY_CONFIG })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'A viewer time zone is required for this report.' })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'a raw database column',
      config: { ...CONFIG, rows: [{ field: 'deal.amountMinor' }] },
    },
    {
      name: 'SQL-like field input',
      config: { ...CONFIG, rows: [{ field: 'stage; DROP TABLE "Deal"' }] },
    },
    {
      name: 'an attempted org override',
      config: { ...CONFIG, orgId: 'org-b' },
    },
  ])('rejects $name before compiling a query', async ({ config }) => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config })

    expect(response.status).toBe(400)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })
})
