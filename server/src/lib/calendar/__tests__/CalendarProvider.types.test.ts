import { describe, expect, it } from 'vitest'
import type {
  AllDayCalendarEvent,
  CalendarDate,
  CalendarEvent,
  CalendarProvider,
  CreateCalendarEventInput,
  DeleteCalendarEventInput,
  RespondToCalendarEventInput,
  TimedCalendarEvent,
  UpdateCalendarEventInput,
} from '../CalendarProvider.js'

type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const timedEvent: TimedCalendarEvent = {
  kind: 'timed',
  providerEventId: 'event-1',
  providerCalendarId: 'calendar-1',
  iCalUid: 'event-1@example.com',
  version: 'etag-1',
  title: 'Planning',
  description: null,
  location: null,
  webLink: null,
  startsAt: new Date('2026-08-23T14:00:00.000Z'),
  endsAt: new Date('2026-08-23T15:00:00.000Z'),
  attendees: [],
  organizer: null,
  status: 'confirmed',
  recurrence: { kind: 'none' },
}

const allDayEvent: AllDayCalendarEvent = {
  kind: 'all-day',
  providerEventId: 'event-2',
  providerCalendarId: 'calendar-1',
  iCalUid: null,
  version: null,
  title: 'Company holiday',
  description: null,
  location: null,
  webLink: null,
  startDate: '2026-12-25' as CalendarDate,
  endDateExclusive: '2026-12-26' as CalendarDate,
  attendees: [],
  organizer: null,
  status: 'confirmed',
  recurrence: { kind: 'none' },
}

const provider = {
  provider: 'google',
  capabilities: {
    calendarInventory: true,
    eventRead: true,
    eventWrite: true,
    recurrence: true,
    rsvp: true,
    availability: true,
    eventVersioning: true,
  },
  async listCalendars(_cursor: string | null, _limit: number) {
    return { calendars: [], nextCursor: null }
  },
  async getCalendar(providerCalendarId: string) {
    return {
      providerCalendarId,
      name: 'Primary',
      description: null,
      timeZone: 'America/New_York',
      accessRole: 'owner' as const,
      isPrimary: true,
    }
  },
  async listEvents(_input: { providerCalendarId: string; cursor: string | null; limit: number }) {
    return { events: [] as CalendarEvent[], nextCursor: null }
  },
  async getEvent(_input: { providerCalendarId: string; providerEventId: string }) {
    return timedEvent
  },
  async createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    return { ...input, providerEventId: 'created', iCalUid: null, version: 'v1', organizer: null, webLink: null }
  },
  async updateEvent(input: UpdateCalendarEventInput): Promise<CalendarEvent> {
    return { ...timedEvent, providerCalendarId: input.providerCalendarId, providerEventId: input.providerEventId, title: input.patch.title ?? timedEvent.title }
  },
  async deleteEvent(_input: DeleteCalendarEventInput) {},
  async respondToEvent(_input: RespondToCalendarEventInput) {},
  async getAvailability(_input: { providerCalendarIds: string[]; startsAt: Date; endsAt: Date }) {
    return { busy: [] }
  },
} satisfies CalendarProvider

describe('CalendarProvider — the published contract', () => {
  it('keeps timed instants and all-day dates mutually exclusive', () => {
    const events: CalendarEvent[] = [timedEvent, allDayEvent]
    expect(events.map((event) => event.kind)).toEqual(['timed', 'all-day'])
    expect(timedEvent.startsAt.toISOString()).toBe('2026-08-23T14:00:00.000Z')
    expect(allDayEvent.startDate).toBe('2026-12-25')
  })

  it('publishes all calendar lifecycle capability flags', () => {
    expect(provider.capabilities).toEqual({
      calendarInventory: true,
      eventRead: true,
      eventWrite: true,
      recurrence: true,
      rsvp: true,
      availability: true,
      eventVersioning: true,
    })
  })

  it('uses an opaque provider version for optimistic writes', async () => {
    const updated = await provider.updateEvent({
      providerCalendarId: 'calendar-1',
      providerEventId: 'event-1',
      expectedVersion: 'etag-1',
      scope: 'this-event',
      patch: { title: 'Renamed' },
    })
    expect(updated.version).toBe('etag-1')
    expect(updated.title).toBe('Renamed')
  })

  it('pins the exact discriminated time variants', () => {
    type _TimedIsUtcInstants = Expect<
      Pick<TimedCalendarEvent, 'kind' | 'startsAt' | 'endsAt'>,
      { kind: 'timed'; startsAt: Date; endsAt: Date }
    >
    type _AllDayIsDateOnly = Expect<
      Pick<AllDayCalendarEvent, 'kind' | 'startDate' | 'endDateExclusive'>,
      { kind: 'all-day'; startDate: CalendarDate; endDateExclusive: CalendarDate }
    >
    const timed: _TimedIsUtcInstants = true
    const allDay: _AllDayIsDateOnly = true
    expect(timed && allDay).toBe(true)
  })
})
