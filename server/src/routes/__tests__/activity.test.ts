// Route tests for /api/orgs/:orgId/activity (MAI-140, T12).
//
// The unit suite mocks Prisma, so it proves the route WIRING — and for this route
// the wiring IS the acceptance criterion. It proves the read is ONE query with no
// join (no `count` beside it, no `include`), that the org comes from the path and
// reaches the where clause, that "just my activity" filters on the VERIFIED caller
// rather than on anything in the query string, that asking for two spine scopes at
// once is refused rather than silently dropping off its index, and that the tenant
// boundary never leaves in a response.
//
// Real row state, the unique constraint, and the atomicity of the feed write are
// proven by activityFeed.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
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

const NOW = new Date('2026-08-21T12:00:00.000Z')
const OCCURRED = new Date('2026-08-20T09:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const USER_A = 'user-a'
const URL_A = `/api/orgs/${ORG_A}/activity`

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

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feed-1', orgId: ORG_A, sourceType: 'call', sourceId: 'call-1',
    summary: 'Called +12025550123 — 4m 12s', preview: 'completed', direction: 'outbound',
    occurredAt: OCCURRED, createdByUserId: USER_A,
    companyId: 'co-1', personId: 'person-1', dealId: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

/** The args the handler passed to findMany, typed so the assertions are not casts. */
function findManyArgs(): {
  where: Record<string, unknown>
  orderBy: Record<string, string>[]
  skip: number
  take: number
  include?: unknown
  select?: unknown
} {
  return prismaMock.activityEntry.findMany.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.activityEntry.findMany.mockResolvedValue([entryRow()])
})

// --- The tenant boundary ------------------------------------------------------

describe('GET /api/orgs/:orgId/activity — membership', () => {
  it('401s without a token', async () => {
    const res = await request(app).get(URL_A)
    expect(res.status).toBe(401)
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('404s a non-member — never 403, which would confirm the org exists', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/activity`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('scopes the read to the org in the PATH, not the caller preference', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(findManyArgs().where).toMatchObject({ orgId: ORG_A })
  })
})

// --- The acceptance criterion: ONE indexed query, no joins --------------------

describe('GET /api/orgs/:orgId/activity — one query, no joins', () => {
  it('reads a Company feed with a SINGLE query', async () => {
    const res = await request(app).get(`${URL_A}?companyId=co-1`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.activityEntry.findMany).toHaveBeenCalledTimes(1)
    // No `total`, so no count beside the page. That second statement is exactly
    // what this route refuses to make.
    expect(prismaMock.activityEntry.count).not.toHaveBeenCalled()
  })

  it('joins nothing — every field a row renders is ON the row', async () => {
    await request(app).get(`${URL_A}?companyId=co-1`).set('Authorization', AUTH)
    const args = findManyArgs()
    expect(args.include).toBeUndefined()
    expect(args.select).toBeUndefined()
  })

  it('asks on (orgId, companyId) ordered by occurredAt — the shape of the index', async () => {
    await request(app).get(`${URL_A}?companyId=co-1`).set('Authorization', AUTH)
    const args = findManyArgs()
    expect(args.where).toEqual({ orgId: ORG_A, companyId: 'co-1' })
    expect(args.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }])
  })

  it('supports the Deal and Person feeds the same way', async () => {
    await request(app).get(`${URL_A}?dealId=deal-1`).set('Authorization', AUTH)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A, dealId: 'deal-1' })

    vi.clearAllMocks()
    authAs()
    prismaMock.activityEntry.findMany.mockResolvedValue([entryRow()])
    await request(app).get(`${URL_A}?personId=person-1`).set('Authorization', AUTH)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A, personId: 'person-1' })
  })

  it('refuses two spine scopes at once rather than falling off its index', async () => {
    const res = await request(app)
      .get(`${URL_A}?companyId=co-1&dealId=deal-1`)
      .set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('one feed at a time')
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('allows no scope at all — the org-wide feed', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A })
  })
})

// --- "Just my activity" -------------------------------------------------------

describe('GET /api/orgs/:orgId/activity — the actor filter', () => {
  it('filters on the VERIFIED caller, never on a value from the query string', async () => {
    await request(app).get(`${URL_A}?mine=true`).set('Authorization', AUTH)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A, createdByUserId: USER_A })
  })

  it('combines with a Company scope, so "my activity here" is one query', async () => {
    await request(app).get(`${URL_A}?companyId=co-1&mine=true`).set('Authorization', AUTH)
    expect(prismaMock.activityEntry.findMany).toHaveBeenCalledTimes(1)
    expect(findManyArgs().where).toEqual({
      orgId: ORG_A,
      companyId: 'co-1',
      createdByUserId: USER_A,
    })
  })

  it('adds nothing when mine=false — that is the whole org feed', async () => {
    await request(app).get(`${URL_A}?mine=false`).set('Authorization', AUTH)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A })
  })

  it('400s an unparseable mine rather than silently answering a different question', async () => {
    const res = await request(app).get(`${URL_A}?mine=yes`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })
})

// --- Filters, paging, and the envelope ---------------------------------------

describe('GET /api/orgs/:orgId/activity — filters and paging', () => {
  it('filters by activity kind and direction', async () => {
    await request(app)
      .get(`${URL_A}?sourceType=meeting&direction=inbound`)
      .set('Authorization', AUTH)
    expect(findManyArgs().where).toMatchObject({ sourceType: 'meeting', direction: 'inbound' })
  })

  it('refuses a source type outside the union', async () => {
    const res = await request(app).get(`${URL_A}?sourceType=voicemail`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('sourceType is one of')
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('applies a HALF-OPEN date window, so a boundary row is not double-counted', async () => {
    await request(app)
      .get(`${URL_A}?occurredFrom=2026-08-01&occurredTo=2026-09-01`)
      .set('Authorization', AUTH)
    const occurredAt = findManyArgs().where.occurredAt as { gte: Date; lt: Date }
    expect(occurredAt.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(occurredAt.lt.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('400s a window that ends before it starts', async () => {
    const res = await request(app)
      .get(`${URL_A}?occurredFrom=2026-09-01&occurredTo=2026-08-01`)
      .set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.activityEntry.findMany).not.toHaveBeenCalled()
  })

  it('reads limit + 1 rows so hasMore needs no second query', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)
    expect(findManyArgs()).toMatchObject({ skip: 20, take: 11 })
  })

  it('reports hasMore and drops the extra row it read to learn it', async () => {
    prismaMock.activityEntry.findMany.mockResolvedValue([
      entryRow({ id: 'feed-1' }),
      entryRow({ id: 'feed-2' }),
      entryRow({ id: 'feed-3' }),
    ])
    const res = await request(app).get(`${URL_A}?limit=2`).set('Authorization', AUTH)
    expect(res.body.hasMore).toBe(true)
    expect(res.body.activity).toHaveLength(2)
    expect(res.body.activity.map((a: { id: string }) => a.id)).toEqual(['feed-1', 'feed-2'])
  })

  it('reports hasMore false on the last page', async () => {
    const res = await request(app).get(`${URL_A}?limit=2`).set('Authorization', AUTH)
    expect(res.body.hasMore).toBe(false)
    expect(res.body.activity).toHaveLength(1)
  })

  it('caps limit at 100 rather than letting one caller ask for the table', async () => {
    const res = await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('100')
  })

  it('walks an account from the beginning when asked to', async () => {
    await request(app).get(`${URL_A}?dir=asc`).set('Authorization', AUTH)
    expect(findManyArgs().orderBy).toEqual([{ occurredAt: 'asc' }, { id: 'asc' }])
  })

  it('treats a blank filter as no filter', async () => {
    await request(app).get(`${URL_A}?companyId=&sourceType=`).set('Authorization', AUTH)
    expect(findManyArgs().where).toEqual({ orgId: ORG_A })
  })
})

describe('GET /api/orgs/:orgId/activity — the response', () => {
  it('returns a keyed envelope with a row that paints itself', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ page: 1, limit: 25, hasMore: false })
    expect(res.body.activity[0]).toEqual({
      id: 'feed-1',
      sourceType: 'call',
      sourceId: 'call-1',
      summary: 'Called +12025550123 — 4m 12s',
      preview: 'completed',
      direction: 'outbound',
      occurredAt: OCCURRED.toISOString(),
      createdByUserId: USER_A,
      companyId: 'co-1',
      personId: 'person-1',
      dealId: null,
      createdAt: NOW.toISOString(),
    })
  })

  it('never leaks the tenant boundary', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.activity[0]).not.toHaveProperty('orgId')
    expect(JSON.stringify(res.body)).not.toContain(ORG_A)
  })
})
