export type CalendarConnectionState = 'connected' | 'not-connected'

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
}

export interface CalendarEvent {
  id: string
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
