// CalendarProvider.ts — THE CALENDAR SEAM. Callers use this contract and never a
// Google or Microsoft SDK shape. It deliberately does not import MailProvider:
// calendar lifecycle and sync semantics evolve independently of mail.

/** A calendar date, deliberately without a clock or timezone. */
export type CalendarDate = `${number}-${number}-${number}`

export type CalendarProviderName = 'google' | 'microsoft'

/** Provider-neutral calendar inventory entry. */
export type Calendar = {
  providerCalendarId: string
  name: string
  description: string | null
  timeZone: string | null
  accessRole: 'owner' | 'writer' | 'reader' | 'free-busy-reader'
  isPrimary: boolean
}

export type CalendarAttendee = {
  email: string
  name?: string
  isOptional: boolean
  isResource: boolean
  response: 'needs-action' | 'accepted' | 'declined' | 'tentative'
}

export type CalendarOrganizer = { email: string; name?: string }

/** A non-recurring event or an event whose series metadata is not available. */
export type CalendarRecurrence =
  | { kind: 'none' }
  | {
      kind: 'series'
      providerSeriesId: string
      recurrenceRule: string
      /** Present only on an overridden occurrence. */
      originalStart: Date | CalendarDate | null
    }

type CalendarEventBase = {
  providerEventId: string
  providerCalendarId: string
  iCalUid: string | null
  /** Opaque provider version (for example, an etag); pass it to conditional writes unchanged. */
  version: string | null
  title: string | null
  description: string | null
  location: string | null
  webLink: string | null
  attendees: CalendarAttendee[]
  organizer: CalendarOrganizer | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  recurrence: CalendarRecurrence
}

/** A timed event always crosses the seam as an absolute UTC instant. */
export type TimedCalendarEvent = CalendarEventBase & {
  kind: 'timed'
  startsAt: Date
  endsAt: Date
}

/** An all-day event intentionally has no time or timezone. The end date is exclusive. */
export type AllDayCalendarEvent = CalendarEventBase & {
  kind: 'all-day'
  startDate: CalendarDate
  endDateExclusive: CalendarDate
}

export type CalendarEvent = TimedCalendarEvent | AllDayCalendarEvent

export type CalendarEventTime =
  | Pick<TimedCalendarEvent, 'kind' | 'startsAt' | 'endsAt'>
  | Pick<AllDayCalendarEvent, 'kind' | 'startDate' | 'endDateExclusive'>

export type CreateCalendarEventInput = Omit<
  CalendarEventBase,
  'providerEventId' | 'iCalUid' | 'version' | 'organizer' | 'webLink'
> &
  CalendarEventTime

export type CalendarEventPatch = Partial<
  Pick<CalendarEventBase, 'title' | 'description' | 'location' | 'attendees' | 'status' | 'recurrence'>
> & { time?: CalendarEventTime }

/** Which portion of a recurring event a lifecycle operation targets. */
export type RecurrenceScope = 'this-event' | 'this-and-following' | 'series'

export type UpdateCalendarEventInput = {
  providerCalendarId: string
  providerEventId: string
  expectedVersion: string | null
  scope: RecurrenceScope
  patch: CalendarEventPatch
}

export type DeleteCalendarEventInput = Omit<UpdateCalendarEventInput, 'patch'>

export type RespondToCalendarEventInput = {
  providerCalendarId: string
  providerEventId: string
  scope: RecurrenceScope
  response: 'accepted' | 'declined' | 'tentative'
  comment?: string
}

export type ListCalendarEventsInput = {
  providerCalendarId: string
  cursor: string | null
  limit: number
  /** UTC instant; omit both bounds to list the provider's default window. */
  startsAt?: Date
  /** UTC instant; omit both bounds to list the provider's default window. */
  endsAt?: Date
}

export type CalendarAvailabilityInput = {
  providerCalendarIds: string[]
  startsAt: Date
  endsAt: Date
}

/** A busy window is always an absolute UTC interval, even when it came from an all-day event. */
export type CalendarBusyInterval = { providerCalendarId: string; startsAt: Date; endsAt: Date }

export type CalendarProviderCapabilities = {
  calendarInventory: boolean
  eventRead: boolean
  eventWrite: boolean
  recurrence: boolean
  rsvp: boolean
  availability: boolean
  eventVersioning: boolean
}

export type CalendarInventoryPage = { calendars: Calendar[]; nextCursor: string | null }
export type CalendarEventPage = { events: CalendarEvent[]; nextCursor: string | null }

/**
 * The provider-neutral calendar boundary. All cursors and versions are opaque:
 * callers persist and replay them but never parse or construct them. Unsupported
 * lifecycle methods throw CalendarCapabilityError rather than leaking SDK errors.
 */
export interface CalendarProvider {
  readonly provider: CalendarProviderName
  readonly capabilities: CalendarProviderCapabilities
  listCalendars(cursor: string | null, limit: number): Promise<CalendarInventoryPage>
  getCalendar(providerCalendarId: string): Promise<Calendar>
  listEvents(input: ListCalendarEventsInput): Promise<CalendarEventPage>
  getEvent(input: Pick<UpdateCalendarEventInput, 'providerCalendarId' | 'providerEventId'>): Promise<CalendarEvent>
  createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent>
  updateEvent(input: UpdateCalendarEventInput): Promise<CalendarEvent>
  deleteEvent(input: DeleteCalendarEventInput): Promise<void>
  respondToEvent(input: RespondToCalendarEventInput): Promise<void>
  getAvailability(input: CalendarAvailabilityInput): Promise<{ busy: CalendarBusyInterval[] }>
}
