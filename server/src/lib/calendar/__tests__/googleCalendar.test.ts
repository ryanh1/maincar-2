import { describe, expect, it, vi } from 'vitest'

import { ProviderApiError } from '../../../../dependencies/providerApiError.js'
import type { GoogleCalendarClient } from '../../../../dependencies/gmail.js'
import { googleCalendar } from '../googleCalendar.js'
import { CalendarAuthError, CalendarCursorExpiredError, CalendarRateLimitedError } from '../calendarErrors.js'

function client(overrides: Partial<GoogleCalendarClient> = {}): GoogleCalendarClient {
  return {
    provider: 'google',
    listCalendarList: vi.fn(async () => ({
      items: [
        {
          id: 'primary',
          summary: 'Main calendar',
          timeZone: 'America/New_York',
          accessRole: 'owner',
          primary: true,
        },
      ],
    })),
    getCalendarListEntry: vi.fn(async () => ({
      id: 'primary',
      summary: 'Main calendar',
      timeZone: 'America/New_York',
      accessRole: 'owner',
      primary: true,
    })),
    listCalendarEvents: vi.fn(async () => ({
      items: [
        {
          id: 'timed',
          etag: 'etag-timed',
          iCalUID: 'timed@example.com',
          summary: 'Planning',
          start: { dateTime: '2026-08-23T09:00:00-04:00' },
          end: { dateTime: '2026-08-23T10:00:00-04:00' },
          attendees: [{ email: 'guest@example.com', responseStatus: 'accepted' }],
          organizer: { email: 'owner@example.com' },
          status: 'confirmed',
        },
        {
          id: 'holiday',
          etag: 'etag-holiday',
          summary: 'Holiday',
          start: { date: '2026-12-25' },
          end: { date: '2026-12-26' },
          status: 'confirmed',
        },
      ],
      nextSyncToken: 'sync-1',
    })),
    getEvent: vi.fn(async () => ({
      id: 'timed',
      etag: 'etag-timed',
      start: { dateTime: '2026-08-23T09:00:00-04:00' },
      end: { dateTime: '2026-08-23T10:00:00-04:00' },
      status: 'confirmed',
    })),
    createCalendarEvent: vi.fn(async (requestBody) => ({
      id: 'created',
      etag: 'etag-created',
      ...requestBody,
      status: 'confirmed',
    })),
    patchEvent: vi.fn(async (_calendarId, _eventId, requestBody) => ({
      id: 'timed',
      etag: 'etag-updated',
      start: { dateTime: '2026-08-23T09:00:00Z' },
      end: { dateTime: '2026-08-23T10:00:00Z' },
      status: 'confirmed',
      ...requestBody,
    })),
    updateEvent: vi.fn(async (_calendarId, _eventId, requestBody) => ({
      id: 'series',
      etag: 'etag-series',
      start: { dateTime: '2026-08-23T09:00:00Z' },
      end: { dateTime: '2026-08-23T10:00:00Z' },
      status: 'confirmed',
      ...requestBody,
    })),
    deleteEvent: vi.fn(async () => undefined),
    queryFreeBusy: vi.fn(async () => ({
      calendars: {
        primary: { busy: [{ start: '2026-08-23T13:00:00Z', end: '2026-08-23T14:00:00Z' }] },
      },
    })),
    ...overrides,
  } as GoogleCalendarClient
}

describe('googleCalendar', () => {
  it('maps calendar inventory and selected-calendar event windows without leaking Google shapes', async () => {
    const google = client()
    const provider = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => google)

    await expect(provider.listCalendars(null, 25)).resolves.toEqual({
      calendars: [
        {
          providerCalendarId: 'primary',
          name: 'Main calendar',
          description: null,
          timeZone: 'America/New_York',
          accessRole: 'owner',
          isPrimary: true,
        },
      ],
      nextCursor: null,
    })

    const page = await provider.listEvents({
      providerCalendarId: 'primary',
      cursor: null,
      limit: 50,
      startsAt: new Date('2026-08-23T00:00:00Z'),
      endsAt: new Date('2026-08-24T00:00:00Z'),
    })

    expect(google.listCalendarEvents).toHaveBeenCalledWith({
      maxResults: 50,
      showDeleted: true,
      singleEvents: false,
      timeMin: '2026-08-23T00:00:00.000Z',
      timeMax: '2026-08-24T00:00:00.000Z',
    }, 'primary')
    expect(page.nextCursor).not.toBe('sync-1')
    expect(page.events[0]).toMatchObject({
      kind: 'timed',
      providerEventId: 'timed',
      providerCalendarId: 'primary',
      version: 'etag-timed',
      attendees: [{ email: 'guest@example.com', response: 'accepted' }],
    })
    expect(page.events[0]).toMatchObject({ startsAt: new Date('2026-08-23T13:00:00.000Z') })
    expect(page.events[1]).toMatchObject({ kind: 'all-day', startDate: '2026-12-25', endDateExclusive: '2026-12-26' })

    await provider.listEvents({ providerCalendarId: 'primary', cursor: page.nextCursor, limit: 50 })
    expect(google.listCalendarEvents).toHaveBeenLastCalledWith({
      maxResults: 50,
      showDeleted: true,
      singleEvents: false,
      syncToken: 'sync-1',
    }, 'primary')
  })

  it('sends UTC instants, date-only all-day events, versions, RSVP, and free/busy through Google correctly', async () => {
    const google = client()
    const provider = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => google)

    await provider.createEvent({
      providerCalendarId: 'primary', title: 'Holiday', description: null,
      location: null, attendees: [], status: 'confirmed', recurrence: { kind: 'none' },
      kind: 'all-day', startDate: '2026-12-25', endDateExclusive: '2026-12-26',
    })
    await provider.updateEvent({
      providerCalendarId: 'primary', providerEventId: 'timed', expectedVersion: 'etag-timed', scope: 'this-event',
      patch: { title: 'Moved' },
    })
    await provider.deleteEvent({ providerCalendarId: 'primary', providerEventId: 'timed', expectedVersion: 'etag-timed', scope: 'this-event' })
    await provider.respondToEvent({ providerCalendarId: 'primary', providerEventId: 'timed', scope: 'this-event', response: 'accepted', comment: 'See you there' })
    await expect(provider.getAvailability({
      providerCalendarIds: ['primary'], startsAt: new Date('2026-08-23T13:00:00Z'), endsAt: new Date('2026-08-23T15:00:00Z'),
    })).resolves.toEqual({ busy: [{ providerCalendarId: 'primary', startsAt: new Date('2026-08-23T13:00:00Z'), endsAt: new Date('2026-08-23T14:00:00Z') }] })

    expect(google.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ start: { date: '2026-12-25' }, end: { date: '2026-12-26' } }), 'primary')
    expect(google.patchEvent).toHaveBeenCalledWith('primary', 'timed', { summary: 'Moved' }, 'etag-timed')
    expect(google.deleteEvent).toHaveBeenCalledWith('primary', 'timed', 'etag-timed')
    expect(google.patchEvent).toHaveBeenLastCalledWith('primary', 'timed', {
      attendeesOmitted: true,
      attendees: [{ email: 'owner@example.com', responseStatus: 'accepted', comment: 'See you there' }],
    })
    expect(google.queryFreeBusy).toHaveBeenCalledWith({
      timeMin: '2026-08-23T13:00:00.000Z', timeMax: '2026-08-23T15:00:00.000Z', timeZone: 'UTC', items: [{ id: 'primary' }],
    })
  })

  it('maps expired, auth, and rate-limited Google responses to calendar errors', async () => {
    const expired = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => client({
      listCalendarEvents: vi.fn(async () => { throw new ProviderApiError('google', { status: 410 }) }),
    }))
    await expect(expired.listEvents({ providerCalendarId: 'primary', cursor: 'stale', limit: 10 })).rejects.toBeInstanceOf(CalendarCursorExpiredError)

    const auth = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => client({
      listCalendarList: vi.fn(async () => { throw new ProviderApiError('google', { status: 401 }) }),
    }))
    await expect(auth.listCalendars(null, 10)).rejects.toBeInstanceOf(CalendarAuthError)

    const limited = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => client({
      listCalendarList: vi.fn(async () => { throw new ProviderApiError('google', { status: 429, retryAfterMs: 1200 }) }),
    }))
    await expect(limited.listCalendars(null, 10)).rejects.toMatchObject({
      name: CalendarRateLimitedError.name,
      retryAfterMs: 1200,
    })
  })

  it('splits a recurring series when a change starts at one occurrence and carries the version to the original series', async () => {
    const google = client({
      getEvent: vi.fn(async (_calendarId, eventId) => eventId === 'occurrence'
        ? {
            id: 'occurrence', recurringEventId: 'series', originalStartTime: { dateTime: '2026-08-30T09:00:00Z' },
            start: { dateTime: '2026-08-30T09:00:00Z' }, end: { dateTime: '2026-08-30T10:00:00Z' }, status: 'confirmed',
          }
        : {
            id: 'series', etag: 'series-etag', summary: 'Weekly planning', location: 'Room A',
            recurrence: ['RRULE:FREQ=WEEKLY'], start: { dateTime: '2026-08-02T09:00:00Z' },
            end: { dateTime: '2026-08-02T10:00:00Z' }, status: 'confirmed',
          }),
    })
    const provider = googleCalendar({ connectionId: 'connection-1', emailAddress: 'owner@example.com' }, async () => google)

    await provider.updateEvent({
      providerCalendarId: 'primary', providerEventId: 'occurrence', expectedVersion: 'series-etag', scope: 'this-and-following',
      patch: { location: 'Room B' },
    })

    expect(google.updateEvent).toHaveBeenCalledWith('primary', 'series', expect.objectContaining({
      recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20260830T085959Z'],
    }), 'series-etag')
    expect(google.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      location: 'Room B', recurrence: ['RRULE:FREQ=WEEKLY'],
      start: { dateTime: '2026-08-30T09:00:00.000Z', timeZone: 'UTC' },
    }), 'primary')
  })
})
