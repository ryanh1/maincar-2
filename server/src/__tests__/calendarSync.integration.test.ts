import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import type { Calendar, CalendarProvider, TimedCalendarEvent } from '../lib/calendar/CalendarProvider.js'
import { CalendarCursorExpiredError } from '../lib/calendar/calendarErrors.js'
import {
  listSelectedCalendarSources,
  setCalendarSourceSelected,
  syncCalendarInventory,
  syncCalendarSource,
} from '../lib/calendar/calendarSync.js'
import { createTestPrisma, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

const PRIMARY = {
  providerCalendarId: 'primary',
  name: 'Primary',
  description: null,
  timeZone: 'America/New_York',
  accessRole: 'owner' as const,
  isPrimary: true,
}

const SECONDARY = {
  providerCalendarId: 'team',
  name: 'Team',
  description: 'Shared delivery calendar',
  timeZone: 'America/New_York',
  accessRole: 'reader' as const,
  isPrimary: false,
}

function event(overrides: Partial<TimedCalendarEvent> = {}): TimedCalendarEvent {
  return {
    kind: 'timed',
    providerEventId: 'event-1',
    providerCalendarId: 'primary',
    iCalUid: 'event-1@example.test',
    version: 'etag-1',
    title: 'Pipeline review',
    description: 'Review the week',
    location: 'Room 4',
    webLink: 'https://calendar.example.test/events/event-1',
    startsAt: new Date('2026-08-25T14:00:00.000Z'),
    endsAt: new Date('2026-08-25T15:00:00.000Z'),
    attendees: [{ email: 'owner@example.test', isOptional: false, isResource: false, response: 'accepted' }],
    organizer: { email: 'owner@example.test' },
    status: 'confirmed',
    recurrence: { kind: 'none' },
    ...overrides,
  }
}

function providerFor(opts: {
  calendars?: Calendar[]
  listEvents?: CalendarProvider['listEvents']
} = {}): CalendarProvider {
  return {
    provider: 'google',
    capabilities: { calendarInventory: true, eventRead: true, eventWrite: true, recurrence: true, rsvp: true, availability: true, eventVersioning: true },
    listCalendars: vi.fn(async () => ({ calendars: opts.calendars ?? [PRIMARY], nextCursor: null })),
    getCalendar: vi.fn(),
    listEvents: opts.listEvents ?? vi.fn(async () => ({ events: [], nextCursor: null })),
    getEvent: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    respondToEvent: vi.fn(),
    getAvailability: vi.fn(),
  }
}

describe('calendar workspace projection (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function connect(org: { orgId: string; adminUserId: string }, provider = 'google') {
    return prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider,
        providerAccountId: `${provider}-${Math.random().toString(36).slice(2)}`,
        emailAddress: `${provider}@example.test`,
        refreshToken: 'v1.a.b.c',
      },
    })
  }

  it('keeps every account source, while reading a primary plus explicitly selected secondaries', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const connection = await connect(org)
    const provider = providerFor({ calendars: [PRIMARY, SECONDARY] })

    const sources = await syncCalendarInventory(
      { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id }, provider, prisma,
    )
    expect(sources).toHaveLength(2)

    const firstRead = await listSelectedCalendarSources(org.orgId, org.adminUserId, prisma)
    expect(firstRead.map((source) => source.providerCalendarId)).toEqual(['primary'])

    await setCalendarSourceSelected(sources.find((source) => source.providerCalendarId === 'team')!.id, org.orgId, org.adminUserId, true, prisma)
    const secondRead = await listSelectedCalendarSources(org.orgId, org.adminUserId, prisma)
    expect(secondRead.map((source) => source.providerCalendarId).sort()).toEqual(['primary', 'team'])

    await syncCalendarInventory(
      { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id },
      providerFor({ calendars: [{ ...SECONDARY, name: 'Delivery team' }, PRIMARY] }),
      prisma,
    )
    expect(await prisma.calendarSource.count({ where: { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id } })).toBe(2)
    expect((await prisma.calendarSource.findFirstOrThrow({ where: { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id, providerCalendarId: 'team' } })).isSelected).toBe(true)
  })

  it('upserts a changed provider event, retains cancellation tombstones, and advances its opaque cursor', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const connection = await connect(org)
    const [source] = await syncCalendarInventory(
      { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id }, providerFor(), prisma,
    )
    const listEvents = vi.fn()
      .mockResolvedValueOnce({ events: [event()], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ events: [event({ title: 'Moved review', version: 'etag-2', status: 'cancelled', attendees: [] })], nextCursor: 'sync-3' })
    const provider = providerFor({ listEvents })
    const input = { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id, sourceId: source.id }

    await syncCalendarSource(input, provider, prisma)
    await syncCalendarSource(input, provider, prisma)

    expect(listEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: null }))
    expect(listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'page-2' }))
    const stored = await prisma.calendarEvent.findFirstOrThrow({ where: { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id, sourceId: source.id, providerEventId: 'event-1' } })
    expect(stored.title).toBe('Moved review')
    expect(stored.providerVersion).toBe('etag-2')
    expect(stored.status).toBe('cancelled')
    expect(stored.cancelledAt).toBeInstanceOf(Date)
    expect(await prisma.calendarEventAttendee.count({ where: { orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id, eventId: stored.id } })).toBe(0)
    expect((await prisma.calendarSource.findFirstOrThrow({ where: { id: source.id, orgId: org.orgId, userId: org.adminUserId, connectionId: connection.id } })).syncCursor).toBe('sync-3')
  })

  it('restarts once from a fresh cursor after provider expiry, without leaking another tenant source', async () => {
    const owner = await seedOrgWithAdmin(prisma)
    const stranger = await seedOrgWithAdmin(prisma)
    const connection = await connect(owner)
    const [source] = await syncCalendarInventory(
      { orgId: owner.orgId, userId: owner.adminUserId, connectionId: connection.id }, providerFor(), prisma,
    )
    await prisma.calendarSource.updateMany({ where: { id: source.id, orgId: owner.orgId, userId: owner.adminUserId, connectionId: connection.id }, data: { syncCursor: 'expired' } })
    const listEvents = vi.fn()
      .mockRejectedValueOnce(new CalendarCursorExpiredError())
      .mockResolvedValueOnce({ events: [event()], nextCursor: 'fresh-sync' })
    const provider = providerFor({ listEvents })

    await syncCalendarSource({ orgId: owner.orgId, userId: owner.adminUserId, connectionId: connection.id, sourceId: source.id }, provider, prisma)
    expect(listEvents.mock.calls.map(([input]) => input.cursor)).toEqual(['expired', null])
    expect(await prisma.calendarEvent.count({ where: { orgId: owner.orgId, userId: owner.adminUserId, connectionId: connection.id } })).toBe(1)

    const skipped = await syncCalendarSource({ orgId: stranger.orgId, userId: stranger.adminUserId, connectionId: connection.id, sourceId: source.id }, provider, prisma)
    expect(skipped).toBeNull()
    expect(listEvents).toHaveBeenCalledTimes(2)

    expect(await syncCalendarInventory(
      { orgId: stranger.orgId, userId: stranger.adminUserId, connectionId: connection.id }, providerFor(), prisma,
    )).toEqual([])
  })
})
