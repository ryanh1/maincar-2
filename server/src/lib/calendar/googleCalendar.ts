// googleCalendar.ts — Google Calendar's implementation of the provider-neutral
// CalendarProvider seam. Google SDK details stay behind server/dependencies/gmail.

import { z } from 'zod'

import { gmailClient, type GoogleCalendarClient } from '../../../dependencies/gmail.js'
import { ProviderApiError } from '../../../dependencies/providerApiError.js'
import { withFreshAccessToken } from '../mail/oauthConnections.js'
import type {
  Calendar,
  CalendarAttendee,
  CalendarAvailabilityInput,
  CalendarBusyInterval,
  CalendarDate,
  CalendarEvent,
  CalendarEventPatch,
  CalendarProvider,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from './CalendarProvider.js'
import {
  CalendarApiError,
  CalendarAuthError,
  CalendarCursorExpiredError,
  CalendarRateLimitedError,
  CalendarVersionConflictError,
} from './calendarErrors.js'

export interface GoogleCalendarAccount {
  /** The OAuth connection that owns the fresh Google token. */
  connectionId: string
  /** Google needs the attendee's address to record the signed-in user's RSVP. */
  emailAddress: string
}

export type MakeGoogleCalendarClient = (connectionId: string) => Promise<GoogleCalendarClient>

const defaultMakeClient: MakeGoogleCalendarClient = async (connectionId) =>
  gmailClient(await withFreshAccessToken(connectionId))

const CalendarListEntrySchema = z.object({
  id: z.string(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  timeZone: z.string().nullish(),
  accessRole: z.enum(['owner', 'writer', 'reader', 'freeBusyReader']).nullish(),
  primary: z.boolean().nullish(),
})

const CalendarListSchema = z.object({
  items: z.array(CalendarListEntrySchema).nullish(),
  nextPageToken: z.string().nullish(),
  nextSyncToken: z.string().nullish(),
})

const EventDateSchema = z.object({ date: z.string().nullish(), dateTime: z.string().nullish() })

const EventSchema = z.object({
  id: z.string(),
  iCalUID: z.string().nullish(),
  etag: z.string().nullish(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  htmlLink: z.string().nullish(),
  attendees: z.array(z.object({
    email: z.string().nullish(),
    displayName: z.string().nullish(),
    optional: z.boolean().nullish(),
    resource: z.boolean().nullish(),
    responseStatus: z.enum(['needsAction', 'accepted', 'declined', 'tentative']).nullish(),
  })).nullish(),
  organizer: z.object({ email: z.string().nullish(), displayName: z.string().nullish() }).nullish(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).nullish(),
  recurrence: z.array(z.string()).nullish(),
  recurringEventId: z.string().nullish(),
  originalStartTime: EventDateSchema.nullish(),
  start: EventDateSchema.nullish(),
  end: EventDateSchema.nullish(),
})

const EventsSchema = z.object({
  items: z.array(EventSchema).nullish(),
  nextPageToken: z.string().nullish(),
  nextSyncToken: z.string().nullish(),
})

const FreeBusySchema = z.object({
  calendars: z.record(z.string(), z.object({
    busy: z.array(z.object({ start: z.string(), end: z.string() })).nullish(),
  })).nullish(),
})

// Google pages and sync tokens are both opaque strings, but they are NOT
// interchangeable request parameters. Keep the mode inside our own opaque cursor
// so a caller can persist one value without accidentally treating page two as a
// delta read or vice versa.
type GoogleEventCursor = { mode: 'page' | 'sync'; token: string }

function encodeEventCursor(cursor: GoogleEventCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeEventCursor(cursor: string): GoogleEventCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<GoogleEventCursor>
    if ((parsed.mode === 'page' || parsed.mode === 'sync') && typeof parsed.token === 'string') {
      return parsed as GoogleEventCursor
    }
  } catch {
    // A legacy stored Google sync token does not carry our envelope. It remains a
    // sync token; never mistake an unknown cursor for a page token.
  }
  return { mode: 'sync', token: cursor }
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new CalendarApiError(`Google Calendar returned ${what} that Maincar could not read.`)
  return parsed.data
}

function throwMappedError(error: ProviderApiError): never {
  if (error.status === 401) throw new CalendarAuthError()
  if (error.status === 412) throw new CalendarVersionConflictError()
  if (error.status === 429 || error.status === 503) throw new CalendarRateLimitedError(error.retryAfterMs ?? 0)
  throw new CalendarApiError(`Google Calendar request failed${error.status != null ? ` (${error.status})` : ''}.`)
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ProviderApiError) throwMappedError(error)
    throw error
  }
}

function calendarDate(value: string): CalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CalendarApiError('Google Calendar returned an invalid all-day date.')
  return value as CalendarDate
}

function attendeeResponse(value: string | null | undefined): CalendarAttendee['response'] {
  switch (value) {
    case 'accepted': return 'accepted'
    case 'declined': return 'declined'
    case 'tentative': return 'tentative'
    default: return 'needs-action'
  }
}

function mapCalendar(entry: z.infer<typeof CalendarListEntrySchema>): Calendar {
  if (!entry.accessRole) throw new CalendarApiError('Google Calendar returned a calendar without an access role.')
  return {
    providerCalendarId: entry.id,
    name: entry.summary ?? '',
    description: entry.description ?? null,
    timeZone: entry.timeZone ?? null,
    accessRole: entry.accessRole === 'freeBusyReader' ? 'free-busy-reader' : entry.accessRole,
    isPrimary: entry.primary ?? false,
  }
}

function mapEvent(event: z.infer<typeof EventSchema>, providerCalendarId: string): CalendarEvent {
  const start = event.start?.dateTime ?? event.start?.date
  const end = event.end?.dateTime ?? event.end?.date
  if (!start || !end) throw new CalendarApiError('Google Calendar returned an event with no start or end.')
  const recurrenceRule = event.recurrence?.find((rule) => rule.startsWith('RRULE:'))
  const recurrence = recurrenceRule
    ? {
        kind: 'series' as const,
        providerSeriesId: event.recurringEventId ?? event.id,
        recurrenceRule,
        originalStart: event.originalStartTime?.date
          ? calendarDate(event.originalStartTime.date)
          : event.originalStartTime?.dateTime ? new Date(event.originalStartTime.dateTime) : null,
      }
    : { kind: 'none' as const }
  const common = {
    providerEventId: event.id,
    providerCalendarId,
    iCalUid: event.iCalUID ?? null,
    version: event.etag ?? null,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    webLink: event.htmlLink ?? null,
    attendees: (event.attendees ?? []).flatMap((attendee) => attendee.email ? [{
      email: attendee.email,
      ...(attendee.displayName ? { name: attendee.displayName } : {}),
      isOptional: attendee.optional ?? false,
      isResource: attendee.resource ?? false,
      response: attendeeResponse(attendee.responseStatus),
    }] : []),
    organizer: event.organizer?.email ? {
      email: event.organizer.email,
      ...(event.organizer.displayName ? { name: event.organizer.displayName } : {}),
    } : null,
    status: event.status ?? 'confirmed',
    recurrence,
  }
  if (event.start?.date) {
    if (!event.end?.date) throw new CalendarApiError('Google Calendar returned an all-day event without an end date.')
    return { ...common, kind: 'all-day', startDate: calendarDate(event.start.date), endDateExclusive: calendarDate(event.end.date) }
  }
  return { ...common, kind: 'timed', startsAt: new Date(start), endsAt: new Date(end) }
}

function googleAttendees(attendees: CalendarAttendee[]) {
  return attendees.map((attendee) => ({
    email: attendee.email,
    displayName: attendee.name,
    optional: attendee.isOptional,
    resource: attendee.isResource,
    responseStatus: attendee.response === 'needs-action' ? 'needsAction' : attendee.response,
  }))
}

function googleTime(time: CreateCalendarEventInput | NonNullable<CalendarEventPatch['time']>) {
  return time.kind === 'all-day'
    ? { start: { date: time.startDate }, end: { date: time.endDateExclusive } }
    : { start: { dateTime: time.startsAt.toISOString(), timeZone: 'UTC' }, end: { dateTime: time.endsAt.toISOString(), timeZone: 'UTC' } }
}

function recurrence(recurrenceValue: CreateCalendarEventInput['recurrence']) {
  return recurrenceValue.kind === 'series' ? [recurrenceValue.recurrenceRule] : []
}

function createRequest(input: CreateCalendarEventInput) {
  return {
    summary: input.title ?? undefined,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    attendees: googleAttendees(input.attendees),
    status: input.status,
    recurrence: recurrence(input.recurrence),
    ...googleTime(input),
  }
}

function patchRequest(patch: CalendarEventPatch) {
  const request: Record<string, unknown> = {}
  if (patch.title !== undefined) request.summary = patch.title
  if (patch.description !== undefined) request.description = patch.description
  if (patch.location !== undefined) request.location = patch.location
  if (patch.status !== undefined) request.status = patch.status
  if (patch.attendees !== undefined) request.attendees = googleAttendees(patch.attendees)
  if (patch.recurrence !== undefined) request.recurrence = recurrence(patch.recurrence)
  if (patch.time !== undefined) Object.assign(request, googleTime(patch.time))
  return request
}

function eventTimeRequest(event: z.infer<typeof EventSchema>) {
  if (event.start?.date) {
    if (!event.end?.date) throw new CalendarApiError('Google Calendar returned an all-day event without an end date.')
    return { start: { date: event.start.date }, end: { date: event.end.date } }
  }
  if (!event.start?.dateTime || !event.end?.dateTime) throw new CalendarApiError('Google Calendar returned an event with no start or end.')
  return {
    start: { dateTime: new Date(event.start.dateTime).toISOString(), timeZone: 'UTC' },
    end: { dateTime: new Date(event.end.dateTime).toISOString(), timeZone: 'UTC' },
  }
}

function eventRequest(event: z.infer<typeof EventSchema>) {
  return {
    summary: event.summary ?? undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    attendees: (event.attendees ?? []).flatMap((attendee) => attendee.email ? [{
      email: attendee.email,
      displayName: attendee.displayName ?? undefined,
      optional: attendee.optional ?? false,
      resource: attendee.resource ?? false,
      responseStatus: attendee.responseStatus ?? 'needsAction',
    }] : []),
    status: event.status ?? 'confirmed',
    recurrence: event.recurrence ?? [],
    ...eventTimeRequest(event),
  }
}

function recurrenceUntilBefore(originalStart: z.infer<typeof EventDateSchema>): string {
  if (originalStart.date) {
    const previous = new Date(`${originalStart.date}T00:00:00.000Z`)
    previous.setUTCDate(previous.getUTCDate() - 1)
    return previous.toISOString().slice(0, 10).replaceAll('-', '')
  }
  if (!originalStart.dateTime) throw new CalendarApiError('Google Calendar returned a recurring instance without its original start.')
  return new Date(new Date(originalStart.dateTime).getTime() - 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function trimRecurrenceForFollowing(rules: string[], originalStart: z.infer<typeof EventDateSchema>): string[] {
  let foundRule = false
  const until = recurrenceUntilBefore(originalStart)
  const trimmed = rules.map((rule) => {
    if (!rule.startsWith('RRULE:')) return rule
    foundRule = true
    return /(?:^|;)UNTIL=[^;]+/.test(rule)
      ? rule.replace(/(?:^|;)UNTIL=[^;]+/, `;UNTIL=${until}`)
      : `${rule};UNTIL=${until}`
  })
  if (!foundRule) throw new CalendarApiError('Google Calendar returned a recurring series without an RRULE.')
  return trimmed
}

/** Build the Google Calendar adapter for one healthy connected Google account. */
export function googleCalendar(
  account: GoogleCalendarAccount,
  makeClient: MakeGoogleCalendarClient = defaultMakeClient,
): CalendarProvider {
  const client = (): Promise<GoogleCalendarClient> => makeClient(account.connectionId)

  async function resolveEvent(input: Pick<UpdateCalendarEventInput, 'providerCalendarId' | 'providerEventId' | 'scope'>) {
    const current = parseOrThrow(EventSchema, await guard(() => client().then((c) => c.getEvent(input.providerCalendarId, input.providerEventId))), 'an event')
    if (input.scope === 'this-event') return { current, event: current, providerEventId: input.providerEventId }
    const providerEventId = current.recurringEventId ?? input.providerEventId
    if (providerEventId === input.providerEventId) return { current, event: current, providerEventId }
    const series = parseOrThrow(EventSchema, await guard(() => client().then((c) => c.getEvent(input.providerCalendarId, providerEventId))), 'a recurring event')
    return { current, event: series, providerEventId }
  }

  async function splitSeries(input: UpdateCalendarEventInput) {
    const target = await resolveEvent(input)
    if (!target.current.recurringEventId || !target.current.originalStartTime) {
      throw new CalendarApiError('Google Calendar cannot split a non-recurring event.')
    }
    const original = eventRequest(target.event)
    await guard(() => client().then((c) => c.updateEvent(
      input.providerCalendarId,
      target.providerEventId,
      { ...original, recurrence: trimRecurrenceForFollowing(target.event.recurrence ?? [], target.current.originalStartTime!) },
      input.expectedVersion ?? undefined,
    )))
    const raw = await guard(() => client().then((c) => c.createCalendarEvent(
      { ...original, ...eventTimeRequest(target.current), ...patchRequest(input.patch) },
      input.providerCalendarId,
    )))
    return mapEvent(parseOrThrow(EventSchema, raw, 'a split recurring event'), input.providerCalendarId)
  }

  return {
    provider: 'google',
    capabilities: { calendarInventory: true, eventRead: true, eventWrite: true, recurrence: true, rsvp: true, availability: true, eventVersioning: true },

    async listCalendars(cursor, limit) {
      const page = parseOrThrow(CalendarListSchema, await guard(() => client().then((c) => c.listCalendarList({ maxResults: limit, pageToken: cursor ?? undefined }))), 'a calendar list')
      return { calendars: (page.items ?? []).map(mapCalendar), nextCursor: page.nextPageToken ?? null }
    },

    async getCalendar(providerCalendarId) {
      return mapCalendar(parseOrThrow(CalendarListEntrySchema, await guard(() => client().then((c) => c.getCalendarListEntry(providerCalendarId))), 'a calendar'))
    },

    async listEvents(input) {
      let raw: unknown
      try {
        const cursor = input.cursor ? decodeEventCursor(input.cursor) : null
        raw = await client().then((c) => c.listCalendarEvents(
          cursor
            ? cursor.mode === 'page'
              ? { maxResults: input.limit, showDeleted: true, singleEvents: false, pageToken: cursor.token }
              : { maxResults: input.limit, showDeleted: true, singleEvents: false, syncToken: cursor.token }
            : { maxResults: input.limit, showDeleted: true, singleEvents: false, timeMin: input.startsAt?.toISOString(), timeMax: input.endsAt?.toISOString() },
          input.providerCalendarId,
        ))
      } catch (error) {
        if (error instanceof ProviderApiError && error.status === 410) throw new CalendarCursorExpiredError()
        if (error instanceof ProviderApiError) throwMappedError(error)
        throw error
      }
      const page = parseOrThrow(EventsSchema, raw, 'an event list')
      const nextCursor = page.nextPageToken
        ? encodeEventCursor({ mode: 'page', token: page.nextPageToken })
        : page.nextSyncToken ? encodeEventCursor({ mode: 'sync', token: page.nextSyncToken }) : null
      return { events: (page.items ?? []).map((event) => mapEvent(event, input.providerCalendarId)), nextCursor }
    },

    async getEvent(input) {
      const raw = await guard(() => client().then((c) => c.getEvent(input.providerCalendarId, input.providerEventId)))
      return mapEvent(parseOrThrow(EventSchema, raw, 'an event'), input.providerCalendarId)
    },

    async createEvent(input) {
      const raw = await guard(() => client().then((c) => c.createCalendarEvent(createRequest(input), input.providerCalendarId)))
      return mapEvent(parseOrThrow(EventSchema, raw, 'a created event'), input.providerCalendarId)
    },

    async updateEvent(input) {
      if (input.scope === 'this-and-following') return splitSeries(input)
      const target = await resolveEvent(input)
      const raw = await guard(() => client().then((c) => c.patchEvent(
        input.providerCalendarId, target.providerEventId, patchRequest(input.patch), input.expectedVersion ?? undefined,
      )))
      return mapEvent(parseOrThrow(EventSchema, raw, 'an updated event'), input.providerCalendarId)
    },

    async deleteEvent(input) {
      const target = await resolveEvent(input)
      if (input.scope === 'this-and-following') {
        if (!target.current.recurringEventId || !target.current.originalStartTime) {
          throw new CalendarApiError('Google Calendar cannot trim a non-recurring event.')
        }
        await guard(() => client().then((c) => c.updateEvent(
          input.providerCalendarId,
          target.providerEventId,
          { ...eventRequest(target.event), recurrence: trimRecurrenceForFollowing(target.event.recurrence ?? [], target.current.originalStartTime!) },
          input.expectedVersion ?? undefined,
        )))
        return
      }
      await guard(() => client().then((c) => c.deleteEvent(input.providerCalendarId, target.providerEventId, input.expectedVersion ?? undefined)))
    },

    async respondToEvent(input) {
      const target = await resolveEvent(input)
      await guard(() => client().then((c) => c.patchEvent(input.providerCalendarId, target.providerEventId, {
        attendeesOmitted: true,
        attendees: [{ email: account.emailAddress, responseStatus: input.response, comment: input.comment }],
      })) )
    },

    async getAvailability(input: CalendarAvailabilityInput): Promise<{ busy: CalendarBusyInterval[] }> {
      const raw = await guard(() => client().then((c) => c.queryFreeBusy({
        timeMin: input.startsAt.toISOString(), timeMax: input.endsAt.toISOString(), timeZone: 'UTC', items: input.providerCalendarIds.map((id) => ({ id })),
      })))
      const response = parseOrThrow(FreeBusySchema, raw, 'free/busy information')
      return {
        busy: Object.entries(response.calendars ?? {}).flatMap(([providerCalendarId, calendar]) =>
          (calendar.busy ?? []).map((interval) => ({ providerCalendarId, startsAt: new Date(interval.start), endsAt: new Date(interval.end) })),
        ),
      }
    },
  }
}
