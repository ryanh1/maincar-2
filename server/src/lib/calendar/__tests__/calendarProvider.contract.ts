// Shared tests for every CalendarProvider adapter. Provider tests pass a factory
// that turns this declarative scenario into mocked SDK responses; this suite never
// imports a Google or Microsoft SDK.
import { describe, expect, it } from 'vitest'
import type {
  Calendar,
  CalendarEvent,
  CalendarProvider,
  DeleteCalendarEventInput,
  RespondToCalendarEventInput,
  TimedCalendarEvent,
  UpdateCalendarEventInput,
} from '../CalendarProvider.js'
import {
  CalendarApiError,
  CalendarAuthError,
  CalendarCapabilityError,
  CalendarCursorExpiredError,
  CalendarRateLimitedError,
} from '../calendarErrors.js'

export type CalendarProviderFailure = 'auth' | 'rate-limited' | 'malformed'

export type CalendarProviderScenario = {
  calendars?: Calendar[]
  events?: CalendarEvent[]
  capabilities?: Partial<CalendarProvider['capabilities']>
  expiredCursor?: string
  failure?: CalendarProviderFailure
  retryAfterMs?: number
  attempts?: { count: number }
  writes?: {
    updates: UpdateCalendarEventInput[]
    deletes: DeleteCalendarEventInput[]
    responses: RespondToCalendarEventInput[]
  }
}

export type MakeCalendarProvider = (
  scenario: CalendarProviderScenario,
) => CalendarProvider | Promise<CalendarProvider>

function calendar(providerCalendarId: string): Calendar {
  return {
    providerCalendarId,
    name: `Calendar ${providerCalendarId}`,
    description: null,
    timeZone: 'America/New_York',
    accessRole: 'owner',
    isPrimary: providerCalendarId === 'primary',
  }
}

function timedEvent(providerEventId: string, startsAt: string): TimedCalendarEvent {
  return {
    kind: 'timed',
    providerEventId,
    providerCalendarId: 'primary',
    iCalUid: `${providerEventId}@example.com`,
    version: `version-${providerEventId}`,
    title: providerEventId,
    description: null,
    location: null,
    webLink: null,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000),
    attendees: [],
    organizer: null,
    status: 'confirmed',
    recurrence: { kind: 'none' },
  }
}

export function calendarProviderContract(name: string, makeProvider: MakeCalendarProvider): void {
  describe(`CalendarProvider contract — ${name}`, () => {
    it('lists calendar inventory with an opaque cursor that advances', async () => {
      const provider = await makeProvider({ calendars: [calendar('primary'), calendar('team')] })

      const first = await provider.listCalendars(null, 1)
      expect(first.calendars).toHaveLength(1)
      expect(first.nextCursor).not.toBeNull()

      const second = await provider.listCalendars(first.nextCursor, 1)
      expect(second.calendars.map((entry) => entry.providerCalendarId)).toEqual(['team'])
      expect(second.nextCursor).toBeNull()
    })

    it('lists event pages with opaque cursors and preserves the provider version', async () => {
      const provider = await makeProvider({
        events: [
          timedEvent('event-1', '2026-08-23T14:00:00.000Z'),
          timedEvent('event-2', '2026-08-23T15:00:00.000Z'),
        ],
      })

      const first = await provider.listEvents({ providerCalendarId: 'primary', cursor: null, limit: 1 })
      expect(first.events[0].providerEventId).toBe('event-1')
      expect(first.events[0].version).toBe('version-event-1')
      expect(first.nextCursor).not.toBeNull()

      const second = await provider.listEvents({
        providerCalendarId: 'primary',
        cursor: first.nextCursor,
        limit: 1,
      })
      expect(second.events[0].providerEventId).toBe('event-2')
    })

    it('throws a typed cursor-expired error instead of silently restarting', async () => {
      const provider = await makeProvider({ expiredCursor: 'stale' })
      await expect(
        provider.listEvents({ providerCalendarId: 'primary', cursor: 'stale', limit: 10 }),
      ).rejects.toBeInstanceOf(CalendarCursorExpiredError)
    })

    it('surfaces auth and rate-limit failures without internal retries', async () => {
      const authAttempts = { count: 0 }
      const authProvider = await makeProvider({ failure: 'auth', attempts: authAttempts })
      await expect(authProvider.listCalendars(null, 10)).rejects.toBeInstanceOf(CalendarAuthError)
      expect(authAttempts.count).toBe(1)

      const limitedProvider = await makeProvider({ failure: 'rate-limited', retryAfterMs: 4200 })
      const error = await limitedProvider.listCalendars(null, 10).then(
        () => null,
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(CalendarRateLimitedError)
      expect((error as CalendarRateLimitedError).retryAfterMs).toBe(4200)
    })

    it('keeps timed events as exact UTC instants and all-day events as dates', async () => {
      const timed = timedEvent('timed', '2026-08-23T14:30:00.000Z')
      const provider = await makeProvider({
        events: [
          timed,
          {
            kind: 'all-day',
            providerEventId: 'all-day',
            providerCalendarId: 'primary',
            iCalUid: null,
            version: 'v2',
            title: 'Holiday',
            description: null,
            location: null,
            webLink: null,
            startDate: '2026-12-25',
            endDateExclusive: '2026-12-26',
            attendees: [],
            organizer: null,
            status: 'confirmed',
            recurrence: { kind: 'none' },
          },
        ],
      })
      const page = await provider.listEvents({ providerCalendarId: 'primary', cursor: null, limit: 10 })
      const [returnedTimed, returnedAllDay] = page.events

      expect(returnedTimed.kind).toBe('timed')
      if (returnedTimed.kind === 'timed') expect(returnedTimed.startsAt.getTime()).toBe(timed.startsAt.getTime())
      expect(returnedAllDay).toMatchObject({ kind: 'all-day', startDate: '2026-12-25' })
    })

    it('passes recurrence scope and provider versions through event writes unchanged', async () => {
      const writes = { updates: [], deletes: [], responses: [] } satisfies NonNullable<CalendarProviderScenario['writes']>
      const provider = await makeProvider({ writes })
      await provider.updateEvent({
        providerCalendarId: 'primary',
        providerEventId: 'series-1',
        expectedVersion: 'etag-7',
        scope: 'this-and-following',
        patch: { title: 'Moved series' },
      })
      await provider.deleteEvent({
        providerCalendarId: 'primary',
        providerEventId: 'series-1',
        expectedVersion: 'etag-8',
        scope: 'series',
      })
      await provider.respondToEvent({
        providerCalendarId: 'primary',
        providerEventId: 'series-1',
        scope: 'this-event',
        response: 'accepted',
      })

      expect(writes.updates[0]).toMatchObject({ expectedVersion: 'etag-7', scope: 'this-and-following' })
      expect(writes.deletes[0]).toMatchObject({ expectedVersion: 'etag-8', scope: 'series' })
      expect(writes.responses[0]).toMatchObject({ response: 'accepted', scope: 'this-event' })
    })

    it('returns availability as UTC busy intervals and honors its capability flag', async () => {
      const provider = await makeProvider({})
      const availability = await provider.getAvailability({
        providerCalendarIds: ['primary'],
        startsAt: new Date('2026-08-23T14:00:00.000Z'),
        endsAt: new Date('2026-08-23T16:00:00.000Z'),
      })
      expect(availability.busy[0]).toMatchObject({ providerCalendarId: 'primary' })
      expect(availability.busy[0].startsAt).toBeInstanceOf(Date)

      const unsupported = await makeProvider({ capabilities: { availability: false } })
      await expect(
        unsupported.getAvailability({
          providerCalendarIds: ['primary'],
          startsAt: new Date('2026-08-23T14:00:00.000Z'),
          endsAt: new Date('2026-08-23T16:00:00.000Z'),
        }),
      ).rejects.toEqual(expect.objectContaining({ name: CalendarCapabilityError.name, capability: 'availability' }))
    })

    it('normalizes malformed provider data to CalendarApiError, never TypeError', async () => {
      const provider = await makeProvider({ failure: 'malformed' })
      const error = await provider.getCalendar('primary').then(
        () => null,
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(CalendarApiError)
      expect(error).not.toBeInstanceOf(TypeError)
    })
  })
}
