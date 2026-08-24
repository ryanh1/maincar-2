import { describe, expect, it, vi } from 'vitest'

import type { GraphCalendarClient } from '../../../../dependencies/graph.js'
import { ProviderApiError } from '../../../../dependencies/providerApiError.js'
import { CalendarCapabilityError, CalendarCursorExpiredError, CalendarVersionConflictError } from '../calendarErrors.js'
import { microsoftCalendar } from '../microsoftCalendar.js'

const EVENT = {
  id: 'event-1',
  iCalUId: 'ical-1',
  changeKey: 'version-1',
  subject: 'Pipeline review',
  body: { content: '<p>Discuss forecast</p>' },
  location: { displayName: 'Room 2' },
  webLink: 'https://outlook.example/event-1',
  onlineMeeting: { joinUrl: 'https://teams.example/event-1' },
  sensitivity: 'private',
  showAs: 'free',
  start: { dateTime: '2026-08-23T14:00:00.000', timeZone: 'UTC' },
  end: { dateTime: '2026-08-23T15:00:00.000', timeZone: 'UTC' },
  attendees: [{ emailAddress: { address: 'guest@example.com', name: 'Guest' }, type: 'optional', status: { response: 'accepted' } }],
  organizer: { emailAddress: { address: 'organizer@example.com' } },
}

function providerFor(client: object, accountType: 'work-or-school' | 'personal' | 'unknown' = 'work-or-school') {
  return microsoftCalendar(
    { connectionId: 'connection-1', emailAddress: 'rep@example.com', accountType },
    async () => client as GraphCalendarClient,
  )
}

describe('microsoftCalendar', () => {
  it('maps a Graph calendar-inventory page and preserves its opaque continuation link', async () => {
    const client = {
      provider: 'microsoft',
      listCalendars: vi.fn().mockResolvedValue({
        value: [
          {
            id: 'calendar-1',
            name: 'Sales',
            isDefaultCalendar: true,
            canEdit: true,
            timeZone: 'America/New_York',
          },
        ],
        '@odata.nextLink': 'https://graph.example/calendars?$skiptoken=next',
      }),
    } as unknown as GraphCalendarClient
    const provider = microsoftCalendar(
      { connectionId: 'connection-1', emailAddress: 'rep@example.com', accountType: 'work-or-school' },
      async () => client,
    )

    await expect(provider.listCalendars(null, 25)).resolves.toEqual({
      calendars: [
        {
          providerCalendarId: 'calendar-1',
          name: 'Sales',
          description: null,
          timeZone: 'America/New_York',
          accessRole: 'writer',
          isPrimary: true,
        },
      ],
      nextCursor: 'https://graph.example/calendars?$skiptoken=next',
    })
    expect(client.listCalendars).toHaveBeenCalledWith({ limit: 25 })
  })

  it('reads a selected calendar window, maps event versions, and preserves Graph pagination', async () => {
    const listCalendarEvents = vi.fn().mockResolvedValue({
      value: [
        EVENT,
        {
          ...EVENT,
          id: 'holiday',
          subject: 'Holiday',
          isAllDay: true,
          start: { dateTime: '2026-12-25T00:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-12-26T00:00:00.0000000', timeZone: 'UTC' },
        },
      ],
      '@odata.nextLink': 'https://graph.example/calendarView?$skiptoken=next',
    })
    const provider = providerFor({ provider: 'microsoft', listCalendarEvents })

    const page = await provider.listEvents({
      providerCalendarId: 'calendar-1',
      cursor: null,
      limit: 50,
      startsAt: new Date('2026-08-23T00:00:00.000Z'),
      endsAt: new Date('2026-08-24T00:00:00.000Z'),
    })

    expect(listCalendarEvents).toHaveBeenCalledWith({
      calendarId: 'calendar-1',
      startDateTime: '2026-08-23T00:00:00.000Z',
      endDateTime: '2026-08-24T00:00:00.000Z',
      limit: 50,
    })
    expect(page.nextCursor).toBe('https://graph.example/calendarView?$skiptoken=next')
    expect(page.events).toMatchObject([
      { kind: 'timed', providerEventId: 'event-1', providerCalendarId: 'calendar-1', version: 'version-1', availability: 'free', privacy: 'private', meetingLink: 'https://teams.example/event-1', timeZone: 'UTC' },
      { kind: 'all-day', providerEventId: 'holiday', startDate: '2026-12-25', endDateExclusive: '2026-12-26' },
    ])
  })

  it('maps selected-calendar create, series update/delete, and RSVP operations to Graph', async () => {
    const createCalendarEvent = vi.fn().mockResolvedValue(EVENT)
    const getCalendarEvent = vi.fn().mockResolvedValue({ ...EVENT, id: 'occurrence-1', seriesMasterId: 'series-master' })
    const updateCalendarEvent = vi.fn().mockResolvedValue({ ...EVENT, id: 'series-master', subject: 'Updated' })
    const deleteCalendarEvent = vi.fn().mockResolvedValue(undefined)
    const respondToCalendarEvent = vi.fn().mockResolvedValue(undefined)
    const provider = providerFor({
      provider: 'microsoft', createCalendarEvent, getCalendarEvent, updateCalendarEvent, deleteCalendarEvent, respondToCalendarEvent,
    })

    await provider.createEvent({
      providerCalendarId: 'calendar-1', kind: 'timed', startsAt: new Date('2026-08-23T14:00:00.000Z'), endsAt: new Date('2026-08-23T15:00:00.000Z'),
      title: 'Pipeline review', description: '<p>Discuss forecast</p>', location: 'Room 2', attendees: [], status: 'confirmed', availability: 'free', privacy: 'private', recurrence: { kind: 'none' },
    })
    await provider.updateEvent({
      providerCalendarId: 'calendar-1', providerEventId: 'occurrence-1', expectedVersion: 'version-1', scope: 'series', patch: { title: 'Updated' },
    })
    await provider.deleteEvent({ providerCalendarId: 'calendar-1', providerEventId: 'occurrence-1', expectedVersion: 'version-2', scope: 'series' })
    await provider.respondToEvent({ providerCalendarId: 'calendar-1', providerEventId: 'occurrence-1', scope: 'series', response: 'tentative', comment: 'Maybe' })

    expect(createCalendarEvent).toHaveBeenCalledWith('calendar-1', expect.objectContaining({ subject: 'Pipeline review', isAllDay: false, showAs: 'free', sensitivity: 'private' }))
    expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'calendar-1', eventId: 'series-master', expectedVersion: 'version-1', event: { subject: 'Updated' } }))
    expect(deleteCalendarEvent).toHaveBeenCalledWith({ calendarId: 'calendar-1', eventId: 'series-master', expectedVersion: 'version-2' })
    expect(respondToCalendarEvent).toHaveBeenCalledWith({ calendarId: 'calendar-1', eventId: 'series-master', response: 'tentativelyAccept', comment: 'Maybe' })
  })

  it('maps a weekly RRULE series into Graph’s patterned recurrence shape', async () => {
    const createCalendarEvent = vi.fn().mockResolvedValue({ ...EVENT, type: 'seriesMaster', recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
      range: { type: 'numbered', startDate: '2026-08-24', numberOfOccurrences: 4 },
    } })
    const provider = providerFor({ provider: 'microsoft', createCalendarEvent })

    await provider.createEvent({
      providerCalendarId: 'calendar-1', kind: 'timed', startsAt: new Date('2026-08-24T14:00:00.000Z'), endsAt: new Date('2026-08-24T15:00:00.000Z'),
      title: 'Office hours', description: null, location: null, attendees: [], status: 'confirmed',
      recurrence: { kind: 'series', providerSeriesId: 'ignored-for-create', recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', originalStart: null },
    })

    expect(createCalendarEvent).toHaveBeenCalledWith('calendar-1', expect.objectContaining({
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
        range: { type: 'numbered', startDate: '2026-08-24', numberOfOccurrences: 4 },
      },
    }))
  })

  it('states the Graph this-and-following limitation instead of silently editing a different scope', async () => {
    const provider = providerFor({ provider: 'microsoft' })
    await expect(provider.deleteEvent({ providerCalendarId: 'calendar-1', providerEventId: 'event-1', expectedVersion: null, scope: 'this-and-following' }))
      .rejects.toEqual(expect.objectContaining({ name: CalendarCapabilityError.name, capability: 'recurrence.this-and-following' }))
  })

  it('disables availability for personal Microsoft accounts and maps work-account busy windows', async () => {
    const personal = providerFor({ provider: 'microsoft' }, 'personal')
    expect(personal.capabilities.availability).toBe(false)
    await expect(personal.getAvailability({ providerCalendarIds: ['calendar-1'], startsAt: new Date(), endsAt: new Date() }))
      .rejects.toEqual(expect.objectContaining({ name: CalendarCapabilityError.name, capability: 'availability' }))

    const getCalendar = vi.fn().mockResolvedValue({ id: 'calendar-1', name: 'Primary', isDefaultCalendar: true })
    const getSchedule = vi.fn().mockResolvedValue({
      value: [{
        scheduleId: 'rep@example.com',
        scheduleItems: [{ status: 'busy', start: EVENT.start, end: EVENT.end }, { status: 'free', start: EVENT.end, end: EVENT.end }],
      }],
    })
    const work = providerFor({ provider: 'microsoft', getCalendar, getSchedule })
    await expect(work.getAvailability({
      providerCalendarIds: ['calendar-1'], startsAt: new Date('2026-08-23T14:00:00.000Z'), endsAt: new Date('2026-08-23T16:00:00.000Z'),
    })).resolves.toEqual({ busy: [{ providerCalendarId: 'calendar-1', startsAt: new Date('2026-08-23T14:00:00.000Z'), endsAt: new Date('2026-08-23T15:00:00.000Z') }] })
    expect(getSchedule).toHaveBeenCalledWith(expect.objectContaining({ schedules: ['rep@example.com'] }))
  })

  it('normalizes expired cursors and stale write versions into calendar errors', async () => {
    const read = providerFor({ provider: 'microsoft', listCalendarEvents: vi.fn().mockRejectedValue(new ProviderApiError('microsoft', { status: 410 })) })
    await expect(read.listEvents({ providerCalendarId: 'calendar-1', cursor: 'expired', limit: 10 })).rejects.toBeInstanceOf(CalendarCursorExpiredError)

    const write = providerFor({ provider: 'microsoft', updateCalendarEvent: vi.fn().mockRejectedValue(new ProviderApiError('microsoft', { status: 412 })) })
    await expect(write.updateEvent({ providerCalendarId: 'calendar-1', providerEventId: 'event-1', expectedVersion: 'old', scope: 'this-event', patch: {} }))
      .rejects.toBeInstanceOf(CalendarVersionConflictError)
  })
})
