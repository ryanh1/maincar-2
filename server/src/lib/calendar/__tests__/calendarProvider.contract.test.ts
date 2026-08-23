import { describe, expect, it } from 'vitest'
import type {
  Calendar,
  CalendarEvent,
  CalendarProvider,
  CreateCalendarEventInput,
  ListCalendarEventsInput,
  UpdateCalendarEventInput,
} from '../CalendarProvider.js'
import {
  CalendarApiError,
  CalendarAuthError,
  CalendarCapabilityError,
  CalendarCursorExpiredError,
  CalendarRateLimitedError,
} from '../calendarErrors.js'
import {
  calendarProviderContract,
  type CalendarProviderScenario,
} from './calendarProvider.contract.js'

function failure(scenario: CalendarProviderScenario): Error {
  switch (scenario.failure) {
    case 'auth':
      return new CalendarAuthError()
    case 'rate-limited':
      return new CalendarRateLimitedError(scenario.retryAfterMs ?? 0)
    default:
      return new CalendarApiError()
  }
}

function page<T>(items: T[], cursor: string | null, limit: number): { items: T[]; nextCursor: string | null } {
  const offset = cursor === null ? 0 : Number(cursor)
  const next = offset + limit
  return { items: items.slice(offset, next), nextCursor: next < items.length ? String(next) : null }
}

function makeProvider(scenario: CalendarProviderScenario): CalendarProvider {
  const calendars = scenario.calendars ?? []
  const events = scenario.events ?? []
  const capabilities = {
    calendarInventory: true,
    eventRead: true,
    eventWrite: true,
    recurrence: true,
    rsvp: true,
    availability: true,
    eventVersioning: true,
    ...scenario.capabilities,
  }

  const guard = (cursor?: string | null): void => {
    if (scenario.expiredCursor !== undefined && cursor === scenario.expiredCursor) {
      throw new CalendarCursorExpiredError()
    }
    if (scenario.attempts) scenario.attempts.count += 1
    if (scenario.failure) throw failure(scenario)
  }

  const fallbackEvent = (): CalendarEvent => ({
    kind: 'timed',
    providerEventId: 'event',
    providerCalendarId: 'primary',
    iCalUid: null,
    version: 'v1',
    title: null,
    description: null,
    location: null,
    webLink: null,
    startsAt: new Date('2026-08-23T14:00:00.000Z'),
    endsAt: new Date('2026-08-23T15:00:00.000Z'),
    attendees: [],
    organizer: null,
    status: 'confirmed',
    recurrence: { kind: 'none' },
  })

  return {
    provider: 'google',
    capabilities,
    async listCalendars(cursor, limit) {
      guard(cursor)
      const result = page(calendars, cursor, limit)
      return { calendars: result.items, nextCursor: result.nextCursor }
    },
    async getCalendar(providerCalendarId: string): Promise<Calendar> {
      guard()
      const found = calendars.find((entry) => entry.providerCalendarId === providerCalendarId)
      if (!found) throw new CalendarApiError('No such calendar.')
      return found
    },
    async listEvents(input: ListCalendarEventsInput) {
      guard(input.cursor)
      const result = page(events.filter((event) => event.providerCalendarId === input.providerCalendarId), input.cursor, input.limit)
      return { events: result.items, nextCursor: result.nextCursor }
    },
    async getEvent({ providerCalendarId, providerEventId }) {
      guard()
      const found = events.find(
        (event) => event.providerCalendarId === providerCalendarId && event.providerEventId === providerEventId,
      )
      if (!found) throw new CalendarApiError('No such event.')
      return found
    },
    async createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent> {
      guard()
      return { ...input, providerEventId: 'created', iCalUid: null, version: 'v1', organizer: null, webLink: null }
    },
    async updateEvent(input: UpdateCalendarEventInput): Promise<CalendarEvent> {
      guard()
      scenario.writes?.updates.push(input)
      const existing = events.find((event) => event.providerEventId === input.providerEventId) ?? fallbackEvent()
      return { ...existing, ...input.patch, ...(input.patch.time ?? {}) }
    },
    async deleteEvent(input) {
      guard()
      scenario.writes?.deletes.push(input)
    },
    async respondToEvent(input) {
      guard()
      scenario.writes?.responses.push(input)
    },
    async getAvailability(input) {
      guard()
      if (!capabilities.availability) throw new CalendarCapabilityError('availability')
      return {
        busy: [{ providerCalendarId: input.providerCalendarIds[0], startsAt: input.startsAt, endsAt: input.endsAt }],
      }
    },
  }
}

describe('calendarProviderContract self-check', () => {
  it('runs the shared suite against a provider-neutral in-memory fake', () => {
    expect(makeProvider({}).provider).toBe('google')
  })
})

calendarProviderContract('in-memory fake', makeProvider)
