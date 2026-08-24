export type CalendarConnectionState = 'connected' | 'not-connected'
export type CalendarRecurrenceScope = 'this-event' | 'this-and-following' | 'series'
export type CalendarAttendeeResponse = 'needs-action' | 'accepted' | 'declined' | 'tentative'

export interface CalendarAttendee {
  email: string
  name?: string | null
  isOptional: boolean
  isResource: boolean
  response: CalendarAttendeeResponse
}

export type CalendarRecurrence =
  | { kind: 'none' }
  | { kind: 'series'; providerSeriesId: string; recurrenceRule: string; originalStart: string | null }

export interface CalendarSource {
  id: string
  provider: 'google' | 'microsoft'
  providerCalendarId: string
  name: string
  description: string | null
  timeZone: string | null
  accessRole: string
  isPrimary: boolean
  isSelected: boolean
  lastSyncedAt: string | null
  capabilities: { recurrence: boolean; rsvp: boolean; availability: boolean }
  recurrenceScopes: CalendarRecurrenceScope[]
}

export interface CalendarEvent {
  id: string
  providerEventId: string
  sourceId: string
  title: string | null
  startsAt: string
  endsAt: string
  kind: 'timed' | 'all-day'
  timeZone: string | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  availability: 'busy' | 'free'
  privacy: 'default' | 'public' | 'private'
  description?: string | null
  location?: string | null
  webLink?: string | null
  meetingLink?: string | null
  providerVersion?: string | null
  recurrenceKind: 'none' | 'series'
  providerSeriesId: string | null
  recurrenceRule: string | null
  originalStartAt?: string | null
  originalStartDate?: string | null
  attendees: CalendarAttendee[]
  links: CalendarRecordLink[]
  source?: Pick<CalendarSource, 'id' | 'name' | 'provider'>
}

export interface CalendarRecordLink { object: string; id: string }
export type CalendarEventTime = { kind: 'timed'; startsAt: string; endsAt: string } | { kind: 'all-day'; startDate: string; endDateExclusive: string }
export interface CalendarEventCreateInput {
  sourceId: string
  title: string | null
  description?: string | null
  location?: string | null
  status?: CalendarEvent['status']
  availability?: CalendarEvent['availability']
  privacy?: CalendarEvent['privacy']
  meetingLink?: string | null
  attendees?: CalendarAttendee[]
  recurrence?: CalendarRecurrence
  timeZone?: string | null
  links?: CalendarRecordLink[]
  time: CalendarEventTime
}
export interface CalendarEventPatch {
  title?: string | null
  description?: string | null
  location?: string | null
  status?: CalendarEvent['status']
  availability?: CalendarEvent['availability']
  privacy?: CalendarEvent['privacy']
  meetingLink?: string | null
  attendees?: CalendarAttendee[]
  recurrence?: CalendarRecurrence
  timeZone?: string | null
  links?: CalendarRecordLink[]
  time?: CalendarEventTime
}

export interface CalendarSourcesResponse {
  calendar: { state: CalendarConnectionState }
  sources: CalendarSource[]
}

export interface CalendarEventsResponse {
  calendar: { state: CalendarConnectionState }
  events: CalendarEvent[]
  total: number
  page: number
  limit: number
}

export type CalendarAvailabilityResponse = {
  availability:
    | { state: 'available'; busy: Array<{ sourceId: string; startsAt: string; endsAt: string }> }
    | { state: 'unavailable'; reason: string }
}
