import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, googleCalendarMock, syncCalendarSourceMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    calendarSource: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    calendarEvent: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
  googleCalendarMock: vi.fn(),
  syncCalendarSourceMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../lib/calendar/googleCalendar.js', () => ({ googleCalendar: googleCalendarMock }))
vi.mock('../../lib/calendar/microsoftCalendar.js', () => ({ microsoftCalendar: vi.fn() }))
vi.mock('../../lib/calendar/calendarSync.js', () => ({ syncCalendarSource: syncCalendarSourceMock }))

import app from '../../app.js'

const NOW = new Date('2026-08-23T12:00:00.000Z')
const ORG_ID = 'org-a'
const AUTH = 'Bearer token'
const URL = `/api/calendar/orgs/${ORG_ID}`

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1', orgId: ORG_ID, userId: 'user-a', connectionId: 'connection-1',
    provider: 'google', providerCalendarId: 'primary', name: 'Primary', description: null,
    timeZone: 'America/New_York', accessRole: 'owner', isPrimary: true, isSelected: false,
    lastSyncedAt: NOW, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1', orgId: ORG_ID, userId: 'user-a', connectionId: 'connection-1', sourceId: 'source-1',
    providerEventId: 'provider-event-1', providerVersion: 'version-1', iCalUid: null,
    title: 'Planning', description: 'Quarterly planning', location: 'Room A', webLink: null,
    kind: 'timed', startsAt: NOW, endsAt: new Date('2026-08-23T13:00:00.000Z'), timeZone: 'America/New_York',
    status: 'confirmed', cancelledAt: null, recurrenceKind: 'none', providerSeriesId: null,
    recurrenceRule: null, originalStartAt: null, originalStartDate: null, createdAt: NOW, updatedAt: NOW,
    source: source({ connection: { emailAddress: 'rep@example.test' } }), attendees: [], ...overrides,
  }
}

function authAs(member = true) {
  verifyTokenMock.mockResolvedValue({ uid: 'firebase-user' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'firebase-user', email: 'rep@example.test', firstName: null,
    lastName: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
  })
  prismaMock.membership.findFirst.mockResolvedValue(member ? {
    id: 'membership-a', orgId: ORG_ID, userId: 'user-a', isActive: true, roles: ['basic'],
    org: { id: ORG_ID, enabled: true },
  } : null)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.calendarSource.findMany.mockResolvedValue([])
  prismaMock.calendarSource.findFirst.mockResolvedValue(null)
  prismaMock.calendarSource.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.calendarEvent.findMany.mockResolvedValue([])
  prismaMock.calendarEvent.count.mockResolvedValue(0)
  prismaMock.calendarEvent.findFirst.mockResolvedValue(null)
  googleCalendarMock.mockReturnValue({ updateEvent: vi.fn(), createEvent: vi.fn(), deleteEvent: vi.fn(), respondToEvent: vi.fn() })
})

describe('Calendar workspace routes', () => {
  it('makes Calendar unavailability explicit instead of returning an empty source list', async () => {
    const res = await request(app).get(`${URL}/sources`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ calendar: { state: 'not-connected' }, sources: [] })
  })

  it('returns selected projection events in a half-open range and searches title, description, and location', async () => {
    prismaMock.calendarSource.findMany.mockResolvedValue([source()])
    prismaMock.calendarEvent.findMany.mockResolvedValue([event()])
    prismaMock.calendarEvent.count.mockResolvedValue(1)

    const res = await request(app)
      .get(`${URL}/events?startsAt=2026-08-23T00:00:00.000Z&endsAt=2026-08-24T00:00:00.000Z&q=plan`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.events).toHaveLength(1)
    expect(res.body.events[0]).toMatchObject({ id: 'event-1', sourceId: 'source-1', title: 'Planning' })
    expect(prismaMock.calendarEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orgId: ORG_ID, userId: 'user-a', sourceId: { in: ['source-1'] } }),
    }))
  })

  it('does not reveal or change a source owned by another user', async () => {
    const res = await request(app)
      .patch(`${URL}/sources/foreign-source`)
      .set('Authorization', AUTH)
      .send({ isSelected: true })

    expect(res.status).toBe(404)
    expect(prismaMock.calendarSource.updateMany).toHaveBeenCalledWith({
      where: { id: 'foreign-source', orgId: ORG_ID, userId: 'user-a' }, data: { isSelected: true },
    })
  })

  it('rejects an inverted event range before querying the projection', async () => {
    const res = await request(app)
      .get(`${URL}/events?startsAt=2026-08-24T00:00:00.000Z&endsAt=2026-08-23T00:00:00.000Z`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('endsAt')
    expect(prismaMock.calendarEvent.findMany).not.toHaveBeenCalled()
  })

  it('returns an actionable conflict when the provider rejects a stale event version', async () => {
    const { CalendarVersionConflictError } = await import('../../lib/calendar/calendarErrors.js')
    googleCalendarMock.mockReturnValue({ updateEvent: vi.fn().mockRejectedValue(new CalendarVersionConflictError()), createEvent: vi.fn(), deleteEvent: vi.fn(), respondToEvent: vi.fn() })
    prismaMock.calendarEvent.findFirst.mockResolvedValue(event())

    const res = await request(app)
      .patch(`${URL}/events/event-1`)
      .set('Authorization', AUTH)
      .send({ expectedVersion: 'version-1', patch: { title: 'New title' } })

    expect(res.status).toBe(409)
    expect(res.body).toEqual(expect.objectContaining({ code: 'calendar_version_conflict' }))
    expect(syncCalendarSourceMock).not.toHaveBeenCalled()
  })
})
