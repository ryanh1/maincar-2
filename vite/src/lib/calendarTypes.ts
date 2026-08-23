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
