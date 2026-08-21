// Route tests for /api/orgs/:orgId/meetings (MAI-139, T11).
//
// The unit suite mocks Prisma, so it proves the route WIRING: the org comes from
// the path and reaches every where clause — including the nested attendee filter,
// where a missing orgId would reach across tenants — the filters and the
// allowlisted sort do what they say, a meeting in another org is a 404, and
// nothing the client has no business with (orgId, a recording key, the sync
// cursor) is in a response. Real row state and the real unique constraints are
// proven by meetings.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    meeting: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
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
const STARTS = new Date('2026-06-24T22:00:00.000Z')
const ENDS = new Date('2026-06-24T22:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/meetings`

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a', userId: 'user-a', orgId: ORG_A, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function attendeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1', orgId: ORG_A, meetingId: 'mtg-1', name: 'Dana Külz',
    email: 'dana@external-vendor.example', personId: null, responseStatus: 'accepted',
    isOrganizer: false, isOptional: false, isResource: false, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

function meetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mtg-1', orgId: ORG_A, companyId: null, dealId: null,
    title: 'Discovery call', description: 'Agenda: stack, timeline, budget.',
    location: 'HQ, Room 4', joinUrl: 'https://meet.google.com/abc-defg-hij',
    conferenceProvider: 'google_meet',
    isAllDay: false, startsAt: STARTS, endsAt: ENDS, timeZone: 'America/New_York',
    status: 'confirmed', organizerEmail: 'rep@maincar.com', organizerPersonId: null,
    provider: 'google', providerEventId: 'evt-abc', iCalUid: 'abc@google.com',
    recurringEventId: null, syncCursor: '"etag-1"',
    webLink: 'https://calendar.google.com/event?eid=abc',
    recordingUrl: null, recordingProvider: null, transcriptStatus: null,
    externalRecordingId: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.meeting.count.mockResolvedValue(1)
  prismaMock.meeting.findMany.mockResolvedValue([{ ...meetingRow(), _count: { attendees: 2 } }])
  prismaMock.meeting.findFirst.mockResolvedValue({ ...meetingRow(), attendees: [attendeeRow()] })
})

// --- The tenant boundary ------------------------------------------------------

describe('GET /api/orgs/:orgId/meetings — membership', () => {
  it('401s without a token', async () => {
    const res = await request(app).get(URL_A)
    expect(res.status).toBe(401)
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('404s a non-member — never 403, which would confirm the org exists', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/meetings`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('checks membership BEFORE reading any row', async () => {
    authAs(null)
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.meeting.count).not.toHaveBeenCalled()
  })
})

// --- The list -----------------------------------------------------------------

describe('GET /api/orgs/:orgId/meetings', () => {
  it('scopes the read to the org in the PATH', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
    expect(prismaMock.meeting.count.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
  })

  it('counts and pages against the SAME where clause', async () => {
    await request(app).get(`${URL_A}?companyId=co-1&status=confirmed`).set('Authorization', AUTH)
    expect(prismaMock.meeting.count.mock.calls[0][0].where).toEqual(
      prismaMock.meeting.findMany.mock.calls[0][0].where,
    )
  })

  it('returns a keyed page envelope', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 25 })
    expect(res.body.meetings).toHaveLength(1)
    expect(res.body.meetings[0].id).toBe('mtg-1')
  })

  it('defaults to the newest meeting first, with a stable tie-break', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)
    // No nulls:'last' dance — startsAt is NOT NULL on this table.
    expect(prismaMock.meeting.findMany.mock.calls[0][0].orderBy).toEqual([
      { startsAt: 'desc' },
      { createdAt: 'desc' },
    ])
  })

  it('drops the redundant tie-break when the sort already IS createdAt', async () => {
    await request(app).get(`${URL_A}?sort=createdAt&dir=asc`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }])
  })

  it('refuses a sort column outside the allowlist', async () => {
    const res = await request(app).get(`${URL_A}?sort=location`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('caps limit at 100 rather than letting one caller ask for the table', async () => {
    const res = await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('100')
  })

  it('paginates with skip and take', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 })
  })

  it('filters by company, deal, and series', async () => {
    await request(app)
      .get(`${URL_A}?companyId=co-1&dealId=de-1&recurringEventId=rec-1`)
      .set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({
      orgId: ORG_A,
      companyId: 'co-1',
      dealId: 'de-1',
      recurringEventId: 'rec-1',
    })
  })

  it('filters by status, provider, and conference provider', async () => {
    await request(app)
      .get(`${URL_A}?status=cancelled&provider=m365&conferenceProvider=teams`)
      .set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'cancelled',
      provider: 'm365',
      conferenceProvider: 'teams',
    })
  })

  it('refuses a status, provider, or conference provider outside the union', async () => {
    for (const bad of ['status=maybe', 'provider=outlook', 'conferenceProvider=webex']) {
      const res = await request(app).get(`${URL_A}?${bad}`).set('Authorization', AUTH)
      expect(res.status).toBe(400)
    }
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('filters all-day meetings apart from timed ones', async () => {
    await request(app).get(`${URL_A}?isAllDay=true`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({ isAllDay: true })

    vi.clearAllMocks()
    authAs()
    prismaMock.meeting.count.mockResolvedValue(0)
    prismaMock.meeting.findMany.mockResolvedValue([])
    await request(app).get(`${URL_A}?isAllDay=false`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({ isAllDay: false })
  })

  it('answers "in a room?" and "on video?" SEPARATELY — the point of two columns', async () => {
    await request(app).get(`${URL_A}?hasLocation=true&hasJoinUrl=false`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({
      location: { not: null },
      joinUrl: null,
    })
  })

  it('refuses a non-boolean for an is/has flag rather than silently reading it as false', async () => {
    const res = await request(app).get(`${URL_A}?isAllDay=yes`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('carries orgId INTO the nested attendee filter', async () => {
    // A related-row condition is its own query. A `some` without orgId would
    // reach across tenants to decide which of this org's meetings match.
    await request(app)
      .get(`${URL_A}?personId=per-1&email=dana%40external-vendor.example`)
      .set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.AND).toEqual([
      { attendees: { some: { orgId: ORG_A, personId: 'per-1' } } },
      {
        attendees: {
          some: {
            orgId: ORG_A,
            email: { equals: 'dana@external-vendor.example', mode: 'insensitive' },
          },
        },
      },
    ])
  })

  it('finds meetings by a RAW attendee email — the only handle an external attendee has', async () => {
    await request(app)
      .get(`${URL_A}?email=DANA%40External-Vendor.example`)
      .set('Authorization', AUTH)
    // Lower-cased on the way in and matched case-insensitively: an address is not
    // case-sensitive in its domain, and a filter that missed a stored row would
    // be worse than no filter.
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.AND).toEqual([
      {
        attendees: {
          some: {
            orgId: ORG_A,
            email: { equals: 'dana@external-vendor.example', mode: 'insensitive' },
          },
        },
      },
    ])
  })

  it('reads a HALF-OPEN date window, so a month view never double-counts a boundary', async () => {
    await request(app)
      .get(`${URL_A}?startsFrom=2026-06-01T00:00:00.000Z&startsTo=2026-07-01T00:00:00.000Z`)
      .set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.startsAt).toEqual({
      gte: new Date('2026-06-01T00:00:00.000Z'),
      lt: new Date('2026-07-01T00:00:00.000Z'),
    })
  })

  it('refuses a window that ends before it starts', async () => {
    const res = await request(app)
      .get(`${URL_A}?startsFrom=2026-07-01T00:00:00.000Z&startsTo=2026-06-01T00:00:00.000Z`)
      .set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })

  it('searches the title, the description, AND the location', async () => {
    await request(app).get(`${URL_A}?q=Chicago`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.OR).toEqual([
      { title: { contains: 'Chicago', mode: 'insensitive' } },
      { description: { contains: 'Chicago', mode: 'insensitive' } },
      { location: { contains: 'Chicago', mode: 'insensitive' } },
    ])
  })

  it('treats a blank q as no filter at all', async () => {
    await request(app).get(`${URL_A}?q=%20%20`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).not.toHaveProperty('OR')
  })

  it('counts attendees on a list page instead of loading them all', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].include).toEqual({
      _count: { select: { attendees: true } },
    })
    expect(res.body.meetings[0].attendeeCount).toBe(2)
    expect(res.body.meetings[0]).not.toHaveProperty('attendees')
  })

  it('returns location and joinUrl as TWO fields on a list row', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.meetings[0]).toMatchObject({
      location: 'HQ, Room 4',
      joinUrl: 'https://meet.google.com/abc-defg-hij',
      conferenceProvider: 'google_meet',
    })
  })

  it('never returns orgId or the sync cursor in a list row', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.meetings[0]).not.toHaveProperty('orgId')
    expect(res.body.meetings[0]).not.toHaveProperty('syncCursor')
    expect(res.body.meetings[0]).not.toHaveProperty('description')
  })
})

// --- The detail ---------------------------------------------------------------

describe('GET /api/orgs/:orgId/meetings/:id', () => {
  it('looks the row up by id AND orgId together', async () => {
    const res = await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.meeting.findFirst.mock.calls[0][0].where).toEqual({
      id: 'mtg-1',
      orgId: ORG_A,
    })
  })

  it("404s a real id that belongs to another org, the same as one that doesn't exist", async () => {
    prismaMock.meeting.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/mtg-other`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Meeting not found' })
  })

  it('loads the attendees organizer-first, in a stable order', async () => {
    await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(prismaMock.meeting.findFirst.mock.calls[0][0].include).toEqual({
      attendees: { orderBy: [{ isOrganizer: 'desc' }, { email: 'asc' }] },
    })
  })

  it('returns an EXTERNAL attendee with their email and no Person behind it', async () => {
    const res = await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(res.body.meeting.attendees).toHaveLength(1)
    expect(res.body.meeting.attendees[0]).toMatchObject({
      email: 'dana@external-vendor.example',
      name: 'Dana Külz',
      personId: null,
    })
  })

  it('round-trips a TIMED meeting with its IANA zone', async () => {
    const res = await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(res.body.meeting).toMatchObject({
      isAllDay: false,
      startsAt: '2026-06-24T22:00:00.000Z',
      endsAt: '2026-06-24T22:30:00.000Z',
      timeZone: 'America/New_York',
      startDate: null,
      endDate: null,
    })
  })

  it('round-trips an ALL-DAY meeting as dates, with no zone in the payload', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue({
      ...meetingRow({
        title: 'Onsite at customer HQ',
        isAllDay: true,
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2026-08-26T00:00:00.000Z'),
        timeZone: 'Europe/Berlin',
        joinUrl: null,
        conferenceProvider: null,
        location: 'Customer HQ, Berlin',
      }),
      attendees: [],
    })
    const res = await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(res.body.meeting).toMatchObject({
      isAllDay: true,
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      timeZone: null,
    })
    expect(JSON.stringify(res.body)).not.toContain('Europe/Berlin')
  })

  it('never returns orgId, the recording key, or the sync cursor', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue({
      ...meetingRow({
        recordingUrl: 'maincar-meeting-recordings/org-a/mtg-1.mp4',
        recordingProvider: 'recall_ai',
        transcriptStatus: 'done',
      }),
      attendees: [],
    })
    const res = await request(app).get(`${URL_A}/mtg-1`).set('Authorization', AUTH)
    expect(res.body.meeting).not.toHaveProperty('orgId')
    expect(res.body.meeting).not.toHaveProperty('recordingUrl')
    expect(res.body.meeting).not.toHaveProperty('syncCursor')
    expect(res.body.meeting.hasRecording).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('maincar-meeting-recordings')
  })

  it('has no write route at all — scheduling is a later spec', async () => {
    // A half-built control that looks live is worse than no control (CLAUDE.md →
    // Verification before finishing).
    for (const call of [
      request(app).post(URL_A),
      request(app).patch(`${URL_A}/mtg-1`),
      request(app).delete(`${URL_A}/mtg-1`),
    ]) {
      const res = await call.set('Authorization', AUTH).send({ title: 'nope' })
      expect(res.status).toBe(404)
    }
  })
})
