// Route tests for the read-time account timeline (MAI-274).
//
// The unit suite proves the API contract and query budget. The integration suite
// below this route will prove the database index plan against real Postgres.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    activityEntry: { findMany: vi.fn(), count: vi.fn() },
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

const NOW = new Date('2026-08-22T18:30:00.000Z')
const OCCURRED = new Date('2026-08-20T09:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const USER_A = 'user-a'
const URL_A = `/api/orgs/${ORG_A}/account-timeline`

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_A, firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a', userId: USER_A, orgId: ORG_A, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return { id: 'co-1', createdAt: new Date('2026-01-15T00:00:00.000Z'), ...overrides }
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1', orgId: ORG_A, sourceType: 'call', sourceId: 'call-1',
    summary: 'Called +12025550123', preview: 'completed', direction: 'outbound',
    timelineVersion: 1, timelineTitle: 'Called +12025550123', timelineSubtype: 'completed',
    timelineIntensity: 3, timelineDisplay: { actorName: 'Al Pha', personName: 'Pat Person' },
    timelineMarker: null, occurredAt: OCCURRED, createdByUserId: USER_A,
    companyId: 'co-1', personId: 'person-1', dealId: 'deal-1',
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

function findManyArgs(): {
  where: Record<string, unknown>
  orderBy: Record<string, string>[]
  take: number
  include?: unknown
  select?: unknown
} {
  return prismaMock.activityEntry.findMany.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.company.findFirst.mockResolvedValue(companyRow())
  prismaMock.deal.findFirst.mockResolvedValue({ id: 'deal-1', createdAt: NOW, status: 'open', closeDate: null })
  prismaMock.activityEntry.findMany.mockResolvedValue([eventRow()])
})

describe('GET /api/orgs/:orgId/account-timeline — explicit account range', () => {
  it('returns the self-rendering event page from one company-scoped ActivityEntry range query', async () => {
    const res = await request(app)
      .get(`${URL_A}?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01&limit=2&sourceType=call&direction=outbound&personId=person-1&dealId=deal-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-1', orgId: ORG_A, deletedAt: null },
      select: { id: true, createdAt: true },
    })
    expect(prismaMock.activityEntry.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.activityEntry.count).not.toHaveBeenCalled()
    expect(findManyArgs().where).toEqual({
      orgId: ORG_A,
      companyId: 'co-1',
      personId: 'person-1',
      dealId: 'deal-1',
      sourceType: 'call',
      direction: 'outbound',
      occurredAt: {
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lt: new Date('2026-09-01T00:00:00.000Z'),
      },
    })
    expect(findManyArgs().orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }])
    expect(findManyArgs().take).toBe(3)
    expect(findManyArgs().include).toBeUndefined()
    expect(findManyArgs().select).toBeUndefined()
    expect(res.body).toEqual({
      events: [
        {
          id: 'event-1', sourceType: 'call', sourceId: 'call-1', title: 'Called +12025550123',
          preview: 'completed', subtype: 'completed', intensity: 3,
          display: { actorName: 'Al Pha', personName: 'Pat Person' }, marker: null,
          direction: 'outbound', occurredAt: OCCURRED.toISOString(), companyId: 'co-1',
          personId: 'person-1', dealId: 'deal-1',
        },
      ],
      nextCursor: null,
      range: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        isDefault: false,
      },
    })
  })

  it('normalizes a legacy missing display snapshot to a render-safe object', async () => {
    prismaMock.activityEntry.findMany.mockResolvedValue([eventRow({ timelineDisplay: null })])

    const res = await request(app)
      .get(`${URL_A}?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.events[0].display).toEqual({})
  })

  it('requires exactly one supported root scope', async () => {
    const res = await request(app).get(`${URL_A}?rootType=company`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('does not accept company-only contact and deal filters on a deal root', async () => {
    const res = await request(app)
      .get(`${URL_A}?rootType=deal&rootId=deal-1&personId=person-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.deal.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the root does not belong to the requested organization', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .get(`${URL_A}?rootType=company&rootId=other-org-company&occurredFrom=2026-08-01&occurredTo=2026-09-01`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Account not found' })
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('does not reveal a timeline to a non-member', async () => {
    authAs(null)

    const res = await request(app)
      .get(`/api/orgs/${ORG_B}/account-timeline?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/:orgId/account-timeline — smart default range', () => {
  it('uses the dense company frame before reading the event page', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    prismaMock.deal.findFirst.mockResolvedValue(null)
    prismaMock.activityEntry.findMany
      .mockResolvedValueOnce(Array.from({ length: 12 }, (_, index) => eventRow({ id: `recent-${index}` })))
      .mockResolvedValueOnce([eventRow()])

    try {
      const res = await request(app)
        .get(`${URL_A}?rootType=company&rootId=co-1`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(200)
      expect(prismaMock.activityEntry.findMany).toHaveBeenCalledTimes(2)
      expect(prismaMock.activityEntry.findMany.mock.calls[0][0]).toEqual({
        where: { orgId: ORG_A, companyId: 'co-1' },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 12,
        select: { id: true },
      })
      expect(prismaMock.activityEntry.findMany.mock.calls[1][0].where).toEqual({
        orgId: ORG_A,
        companyId: 'co-1',
        occurredAt: {
          gte: new Date('2026-07-23T18:30:00.000Z'),
          lt: new Date('2026-08-29T18:30:00.000Z'),
        },
      })
      expect(res.body.range).toEqual({
        from: '2026-07-23T18:30:00.000Z',
        to: '2026-08-29T18:30:00.000Z',
        isDefault: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('GET /api/orgs/:orgId/account-timeline — cursor paging', () => {
  it('returns an opaque cursor and continues after its timestamp/id pair', async () => {
    const tiedAt = new Date('2026-08-20T09:30:00.000Z')
    prismaMock.activityEntry.findMany
      .mockResolvedValueOnce([eventRow({ id: 'event-b', occurredAt: tiedAt }), eventRow({ id: 'event-a', occurredAt: tiedAt })])
      .mockResolvedValueOnce([eventRow({ id: 'event-a', occurredAt: tiedAt })])

    const first = await request(app)
      .get(`${URL_A}?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01&limit=1`)
      .set('Authorization', AUTH)

    expect(first.status).toBe(200)
    expect(first.body.events.map((event: { id: string }) => event.id)).toEqual(['event-b'])
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await request(app)
      .get(`${URL_A}?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Authorization', AUTH)

    expect(second.status).toBe(200)
    expect(prismaMock.activityEntry.findMany.mock.calls[1][0].where).toEqual({
      orgId: ORG_A,
      companyId: 'co-1',
      occurredAt: {
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lt: new Date('2026-09-01T00:00:00.000Z'),
      },
      AND: [
        {
          OR: [
            { occurredAt: { lt: tiedAt } },
            { occurredAt: tiedAt, id: { lt: 'event-b' } },
          ],
        },
      ],
    })
  })

  it('rejects an invalid cursor before reading events', async () => {
    const res = await request(app)
      .get(`${URL_A}?rootType=company&rootId=co-1&occurredFrom=2026-08-01&occurredTo=2026-09-01&cursor=not-a-cursor`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })
})
