import { z } from 'zod'

import { graphClient, type GraphCalendarClient } from '../../../dependencies/graph.js'
import { ProviderApiError } from '../../../dependencies/providerApiError.js'
import { withFreshAccessToken } from '../mail/oauthConnections.js'
import type {
  Calendar,
  CalendarAvailabilityInput,
  CalendarBusyInterval,
  CalendarEvent,
  CalendarEventPatch,
  CalendarProvider,
  CalendarProviderCapabilities,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from './CalendarProvider.js'
import {
  CalendarApiError,
  CalendarAuthError,
  CalendarCapabilityError,
  CalendarCursorExpiredError,
  CalendarRateLimitedError,
  CalendarVersionConflictError,
} from './calendarErrors.js'

/** The account category must come from the integration layer; it is not safe to infer from an email address. */
export type MicrosoftCalendarAccountType = 'work-or-school' | 'personal' | 'unknown'

export type MicrosoftCalendarAccount = {
  connectionId: string
  emailAddress: string
  accountType: MicrosoftCalendarAccountType
}

export type MakeMicrosoftCalendarClient = (connectionId: string) => Promise<GraphCalendarClient>

const defaultMakeClient: MakeMicrosoftCalendarClient = async (connectionId) =>
  graphClient(await withFreshAccessToken(connectionId))

const GraphAddressSchema = z.object({ name: z.string().nullish(), address: z.string().nullish() })
const GraphRecipientSchema = z.object({ emailAddress: GraphAddressSchema.nullish() })
const GraphDateTimeSchema = z.object({ dateTime: z.string(), timeZone: z.string().nullish() })
const GraphCalendarSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  color: z.string().nullish(),
  isDefaultCalendar: z.boolean().nullish(),
  canEdit: z.boolean().nullish(),
  canShare: z.boolean().nullish(),
  canViewPrivateItems: z.boolean().nullish(),
  timeZone: z.string().nullish(),
  owner: GraphRecipientSchema.nullish(),
})
const GraphCalendarPageSchema = z.object({ value: z.array(GraphCalendarSchema).nullish(), '@odata.nextLink': z.string().nullish() })
const GraphEventSchema = z.object({
  id: z.string(),
  iCalUId: z.string().nullish(),
  changeKey: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.object({ content: z.string().nullish() }).nullish(),
  bodyPreview: z.string().nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  webLink: z.string().nullish(),
  sensitivity: z.string().nullish(),
  onlineMeetingUrl: z.string().nullish(),
  onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(),
  start: GraphDateTimeSchema.nullish(),
  end: GraphDateTimeSchema.nullish(),
  isAllDay: z.boolean().nullish(),
  attendees: z.array(z.object({
    emailAddress: GraphAddressSchema.nullish(),
    type: z.string().nullish(),
    status: z.object({ response: z.string().nullish() }).nullish(),
  })).nullish(),
  organizer: GraphRecipientSchema.nullish(),
  isCancelled: z.boolean().nullish(),
  showAs: z.string().nullish(),
  type: z.string().nullish(),
  seriesMasterId: z.string().nullish(),
  originalStart: z.string().nullish(),
  recurrence: z.object({
    pattern: z.object({
      type: z.string(),
      interval: z.number().int().positive().nullish(),
      daysOfWeek: z.array(z.string()).nullish(),
      dayOfMonth: z.number().int().nullish(),
      month: z.number().int().nullish(),
      index: z.string().nullish(),
    }).passthrough(),
    range: z.object({
      type: z.string(),
      startDate: z.string().nullish(),
      endDate: z.string().nullish(),
      numberOfOccurrences: z.number().int().nullish(),
    }).passthrough(),
  }).nullish(),
})
const GraphEventPageSchema = z.object({ value: z.array(GraphEventSchema).nullish(), '@odata.nextLink': z.string().nullish() })
const GraphScheduleSchema = z.object({
  value: z.array(z.object({
    scheduleId: z.string(),
    scheduleItems: z.array(z.object({
      status: z.string().nullish(),
      start: GraphDateTimeSchema,
      end: GraphDateTimeSchema,
    })).nullish(),
  })).nullish(),
})

type ParsedEvent = z.infer<typeof GraphEventSchema>
type ParsedCalendar = z.infer<typeof GraphCalendarSchema>

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new CalendarApiError(`Graph returned ${what} that Maincar could not read.`)
  return parsed.data
}

function throwMappedError(error: ProviderApiError, isCursorRead = false): never {
  if (isCursorRead && error.status === 410) throw new CalendarCursorExpiredError()
  switch (error.status) {
    case 401:
      throw new CalendarAuthError()
    case 412:
      throw new CalendarVersionConflictError()
    case 429:
    case 503:
      throw new CalendarRateLimitedError(error.retryAfterMs ?? 0)
    default:
      throw new CalendarApiError(`Graph request failed${error.status == null ? '.' : ` (${error.status}).`}`)
  }
}

async function guard<T>(op: () => Promise<T>, isCursorRead = false): Promise<T> {
  try {
    return await op()
  } catch (error) {
    if (error instanceof ProviderApiError) throwMappedError(error, isCursorRead)
    throw error
  }
}

function toDate(dateTime: string, timeZone: string | null | undefined): Date {
  const normalized = dateTime.trim()
  const result = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? new Date(normalized)
    : new Date(`${normalized.replace(/(\.\d{3})\d+$/, '$1')}Z`)
  if (Number.isNaN(result.getTime())) throw new CalendarApiError(`Graph returned an invalid ${timeZone ?? 'UTC'} date-time.`)
  // Calendar reads request Graph's default UTC response; retain this fallback for mocked
  // payloads and providers that include an explicit offset instead.
  return result
}

function toDateOnly(value: string): `${number}-${number}-${number}` {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  if (!match) throw new CalendarApiError('Graph returned an all-day event with an invalid date.')
  return match[0] as `${number}-${number}-${number}`
}

function toGraphDateTime(value: Date | `${number}-${number}-${number}`): { dateTime: string; timeZone: string } {
  if (typeof value === 'string') return { dateTime: `${value}T00:00:00.000`, timeZone: 'UTC' }
  if (Number.isNaN(value.getTime())) throw new CalendarApiError('Calendar input has an invalid date.')
  return { dateTime: value.toISOString().slice(0, -1), timeZone: 'UTC' }
}

function response(value: string | null | undefined): 'needs-action' | 'accepted' | 'declined' | 'tentative' {
  switch (value?.toLowerCase()) {
    case 'accepted': return 'accepted'
    case 'declined': return 'declined'
    case 'tentativelyaccepted':
    case 'tentative': return 'tentative'
    default: return 'needs-action'
  }
}

function status(event: ParsedEvent): 'confirmed' | 'tentative' | 'cancelled' {
  if (event.isCancelled) return 'cancelled'
  return event.showAs === 'tentative' ? 'tentative' : 'confirmed'
}

function availability(event: ParsedEvent): 'busy' | 'free' {
  return event.showAs?.toLowerCase() === 'free' ? 'free' : 'busy'
}

function privacy(event: ParsedEvent): 'default' | 'public' | 'private' {
  return event.sensitivity?.toLowerCase() === 'private' || event.sensitivity?.toLowerCase() === 'confidential'
    ? 'private'
    : 'default'
}

const GRAPH_DAY: Record<string, string> = { monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA', sunday: 'SU' }
const RRULE_DAY: Record<string, string> = Object.fromEntries(Object.entries(GRAPH_DAY).map(([day, code]) => [code, day]))
const GRAPH_INDEX: Record<string, string> = { first: '1', second: '2', third: '3', fourth: '4', last: '-1' }
const RRULE_INDEX: Record<string, string> = Object.fromEntries(Object.entries(GRAPH_INDEX).map(([index, position]) => [position, index]))

function toRRule(recurrence: NonNullable<ParsedEvent['recurrence']>): string {
  const { pattern, range } = recurrence
  const freq: Record<string, string> = {
    daily: 'DAILY', weekly: 'WEEKLY', absoluteMonthly: 'MONTHLY', relativeMonthly: 'MONTHLY', absoluteYearly: 'YEARLY', relativeYearly: 'YEARLY',
  }
  const frequency = freq[pattern.type]
  if (!frequency) throw new CalendarApiError('Graph returned an unsupported recurrence pattern.')
  const pieces = [`FREQ=${frequency}`]
  if (pattern.interval && pattern.interval !== 1) pieces.push(`INTERVAL=${pattern.interval}`)
  if (pattern.daysOfWeek?.length) {
    const days = pattern.daysOfWeek.map((day: string) => GRAPH_DAY[day])
    if (days.some((day) => !day)) throw new CalendarApiError('Graph returned an unsupported recurrence day.')
    pieces.push(`BYDAY=${days.join(',')}`)
  }
  if (pattern.index) {
    const position = GRAPH_INDEX[pattern.index]
    if (!position) throw new CalendarApiError('Graph returned an unsupported recurrence position.')
    pieces.push(`BYSETPOS=${position}`)
  }
  if (pattern.dayOfMonth) pieces.push(`BYMONTHDAY=${pattern.dayOfMonth}`)
  if (pattern.month) pieces.push(`BYMONTH=${pattern.month}`)
  if (range.type === 'numbered' && range.numberOfOccurrences) pieces.push(`COUNT=${range.numberOfOccurrences}`)
  if (range.type === 'endDate' && range.endDate) pieces.push(`UNTIL=${range.endDate.replaceAll('-', '')}`)
  return `RRULE:${pieces.join(';')}`
}

function toRecurrence(event: ParsedEvent) {
  const isSeries = event.type === 'seriesMaster' || event.seriesMasterId != null
  if (!isSeries) return { kind: 'none' } as const
  if (!event.recurrence) throw new CalendarApiError('Graph returned a recurring event with no recurrence rule.')
  return {
    kind: 'series' as const,
    providerSeriesId: event.seriesMasterId ?? event.id,
    recurrenceRule: toRRule(event.recurrence),
    originalStart: event.originalStart ? toDate(event.originalStart, 'UTC') : null,
  }
}

function toCalendarEvent(event: ParsedEvent, providerCalendarId: string): CalendarEvent {
  if (!event.start || !event.end) throw new CalendarApiError('Graph returned an event with no start or end.')
  const shared = {
    providerEventId: event.id,
    providerCalendarId,
    iCalUid: event.iCalUId ?? null,
    version: event.changeKey ?? null,
    title: event.subject ?? null,
    description: event.body?.content ?? event.bodyPreview ?? null,
    location: event.location?.displayName ?? null,
    webLink: event.webLink ?? null,
    meetingLink: event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? null,
    availability: availability(event),
    privacy: privacy(event),
    attendees: (event.attendees ?? []).flatMap((attendee) => {
      const email = attendee.emailAddress?.address
      if (!email) return []
      return [{
        email,
        ...(attendee.emailAddress?.name ? { name: attendee.emailAddress.name } : {}),
        isOptional: attendee.type === 'optional',
        isResource: attendee.type === 'resource',
        response: response(attendee.status?.response),
      }]
    }),
    organizer: event.organizer?.emailAddress?.address
      ? { email: event.organizer.emailAddress.address, ...(event.organizer.emailAddress.name ? { name: event.organizer.emailAddress.name } : {}) }
      : null,
    status: status(event),
    recurrence: toRecurrence(event),
  }
  return event.isAllDay
    ? { ...shared, kind: 'all-day', startDate: toDateOnly(event.start.dateTime), endDateExclusive: toDateOnly(event.end.dateTime) }
    : { ...shared, kind: 'timed', startsAt: toDate(event.start.dateTime, event.start.timeZone), endsAt: toDate(event.end.dateTime, event.end.timeZone), timeZone: event.start.timeZone ?? null }
}

function toCalendar(calendar: ParsedCalendar, accountEmail: string): Calendar {
  const owner = calendar.owner?.emailAddress?.address
  return {
    providerCalendarId: calendar.id,
    name: calendar.name ?? '',
    description: null,
    timeZone: calendar.timeZone ?? null,
    accessRole: owner?.toLowerCase() === accountEmail.toLowerCase() ? 'owner' : calendar.canEdit ? 'writer' : 'reader',
    isPrimary: calendar.isDefaultCalendar ?? false,
  }
}

function toGraphAttendees(attendees: CalendarEvent['attendees']) {
  return attendees.map((attendee) => ({
    emailAddress: { address: attendee.email, ...(attendee.name ? { name: attendee.name } : {}) },
    type: attendee.isResource ? 'resource' : attendee.isOptional ? 'optional' : 'required',
  }))
}

function parseRRule(rule: string, startDate: `${number}-${number}-${number}`): Record<string, unknown> {
  const entries = Object.fromEntries(rule.replace(/^RRULE:/i, '').split(';').map((part) => part.split('=', 2)))
  const frequency = entries.FREQ?.toUpperCase()
  const interval = Number(entries.INTERVAL ?? 1)
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency ?? '') || !Number.isInteger(interval) || interval < 1) {
    throw new CalendarApiError('Calendar recurrence must be a supported RRULE.')
  }
  const days = entries.BYDAY?.split(',').map((day: string) => RRULE_DAY[day])
  if (days?.some((day: string | undefined) => !day)) throw new CalendarApiError('Calendar recurrence has an unsupported BYDAY value.')
  const monthly = frequency === 'MONTHLY'
  const yearly = frequency === 'YEARLY'
  const type = frequency === 'DAILY' ? 'daily'
    : frequency === 'WEEKLY' ? 'weekly'
      : monthly ? (days?.length ? 'relativeMonthly' : 'absoluteMonthly')
        : days?.length ? 'relativeYearly' : 'absoluteYearly'
  const pattern: Record<string, unknown> = { type, interval }
  if (days?.length) pattern.daysOfWeek = days
  if ((monthly || yearly) && days?.length) {
    const index = entries.BYSETPOS ? RRULE_INDEX[entries.BYSETPOS] : undefined
    if (!index) throw new CalendarApiError('Monthly and yearly weekday recurrences require a supported BYSETPOS value.')
    pattern.index = index
  }
  if (entries.BYMONTHDAY) pattern.dayOfMonth = Number(entries.BYMONTHDAY)
  if (yearly && entries.BYMONTH) pattern.month = Number(entries.BYMONTH)
  const range: Record<string, unknown> = { startDate }
  if (entries.COUNT) Object.assign(range, { type: 'numbered', numberOfOccurrences: Number(entries.COUNT) })
  else if (entries.UNTIL) Object.assign(range, { type: 'endDate', endDate: entries.UNTIL.replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3') })
  else range.type = 'noEnd'
  return { pattern, range }
}

function toGraphEvent(input: CreateCalendarEventInput): Record<string, unknown> {
  const start = input.kind === 'all-day' ? input.startDate : input.startsAt
  const end = input.kind === 'all-day' ? input.endDateExclusive : input.endsAt
  return {
    subject: input.title ?? undefined,
    body: input.description == null ? undefined : { contentType: 'HTML', content: input.description },
    location: input.location == null ? undefined : { displayName: input.location },
    start: toGraphDateTime(start),
    end: toGraphDateTime(end),
    isAllDay: input.kind === 'all-day',
    attendees: toGraphAttendees(input.attendees),
    showAs: input.availability === 'free' ? 'free' : input.status === 'tentative' ? 'tentative' : 'busy',
    sensitivity: input.privacy === 'private' ? 'private' : 'normal',
    recurrence: input.recurrence.kind === 'series' ? parseRRule(input.recurrence.recurrenceRule, typeof start === 'string' ? start : start.toISOString().slice(0, 10) as `${number}-${number}-${number}`) : undefined,
  }
}

function toGraphPatch(patch: CalendarEventPatch): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (patch.title !== undefined) result.subject = patch.title
  if (patch.description !== undefined) result.body = { contentType: 'HTML', content: patch.description ?? '' }
  if (patch.location !== undefined) result.location = { displayName: patch.location ?? '' }
  if (patch.attendees !== undefined) result.attendees = toGraphAttendees(patch.attendees)
  if (patch.status !== undefined) result.showAs = patch.status === 'tentative' ? 'tentative' : 'busy'
  if (patch.availability !== undefined) result.showAs = patch.availability === 'free' ? 'free' : 'busy'
  if (patch.privacy !== undefined) result.sensitivity = patch.privacy === 'private' ? 'private' : 'normal'
  if (patch.time) {
    const start = patch.time.kind === 'all-day' ? patch.time.startDate : patch.time.startsAt
    const end = patch.time.kind === 'all-day' ? patch.time.endDateExclusive : patch.time.endsAt
    result.start = toGraphDateTime(start)
    result.end = toGraphDateTime(end)
    result.isAllDay = patch.time.kind === 'all-day'
  }
  if (patch.recurrence !== undefined) {
    if (patch.recurrence.kind === 'none') result.recurrence = null
    else {
      if (!patch.time) throw new CalendarApiError('Changing a recurrence rule requires its event start time.')
      const start = patch.time.kind === 'all-day' ? patch.time.startDate : patch.time.startsAt.toISOString().slice(0, 10) as `${number}-${number}-${number}`
      result.recurrence = parseRRule(patch.recurrence.recurrenceRule, start)
    }
  }
  return result
}

function unavailableAvailability(): CalendarCapabilityError {
  return new CalendarCapabilityError('availability', 'Microsoft Graph availability is unavailable for personal or unknown Microsoft account types.')
}

export function microsoftCalendar(
  account: MicrosoftCalendarAccount,
  makeClient: MakeMicrosoftCalendarClient = defaultMakeClient,
): CalendarProvider {
  const capabilities: CalendarProviderCapabilities = {
    calendarInventory: true,
    eventRead: true,
    eventWrite: true,
    recurrence: true,
    rsvp: true,
    availability: account.accountType === 'work-or-school',
    eventVersioning: true,
  }
  const client = (): Promise<GraphCalendarClient> => makeClient(account.connectionId)
  const resolveEventId = async (input: Pick<UpdateCalendarEventInput, 'providerCalendarId' | 'providerEventId' | 'scope'>): Promise<string> => {
    if (input.scope === 'this-event') return input.providerEventId
    if (input.scope === 'this-and-following') {
      throw new CalendarCapabilityError('recurrence.this-and-following', 'Microsoft Graph does not support changing this and following occurrences as one operation.')
    }
    const raw = await guard(() => client().then((value) => value.getCalendarEvent(input.providerCalendarId, input.providerEventId)))
    const event = parseOrThrow(GraphEventSchema, raw, 'an event')
    return event.seriesMasterId ?? event.id
  }

  return {
    provider: 'microsoft',
    capabilities,

    async listCalendars(cursor, limit) {
      const raw = await guard(() => client().then((value) => value.listCalendars(cursor ? { cursor } : { limit })), true)
      const page = parseOrThrow(GraphCalendarPageSchema, raw, 'a calendar page')
      return { calendars: (page.value ?? []).map((calendar) => toCalendar(calendar, account.emailAddress)), nextCursor: page['@odata.nextLink'] ?? null }
    },

    async getCalendar(providerCalendarId) {
      const raw = await guard(() => client().then((value) => value.getCalendar(providerCalendarId)))
      return toCalendar(parseOrThrow(GraphCalendarSchema, raw, 'a calendar'), account.emailAddress)
    },

    async listEvents(input) {
      const startDateTime = input.startsAt?.toISOString() ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
      const endDateTime = input.endsAt?.toISOString() ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      const raw = await guard(() => client().then((value) => value.listCalendarEvents(
        input.cursor ? { calendarId: input.providerCalendarId, cursor: input.cursor } : { calendarId: input.providerCalendarId, startDateTime, endDateTime, limit: input.limit },
      )), true)
      const page = parseOrThrow(GraphEventPageSchema, raw, 'an event page')
      return { events: (page.value ?? []).map((event) => toCalendarEvent(event, input.providerCalendarId)), nextCursor: page['@odata.nextLink'] ?? null }
    },

    async getEvent(input) {
      const raw = await guard(() => client().then((value) => value.getCalendarEvent(input.providerCalendarId, input.providerEventId)))
      return toCalendarEvent(parseOrThrow(GraphEventSchema, raw, 'an event'), input.providerCalendarId)
    },

    async createEvent(input) {
      const raw = await guard(() => client().then((value) => value.createCalendarEvent(input.providerCalendarId, toGraphEvent(input))))
      return toCalendarEvent(parseOrThrow(GraphEventSchema, raw, 'a created event'), input.providerCalendarId)
    },

    async updateEvent(input) {
      const eventId = await resolveEventId(input)
      const raw = await guard(() => client().then((value) => value.updateCalendarEvent({
        calendarId: input.providerCalendarId,
        eventId,
        event: toGraphPatch(input.patch),
        ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
      })))
      return toCalendarEvent(parseOrThrow(GraphEventSchema, raw, 'an updated event'), input.providerCalendarId)
    },

    async deleteEvent(input) {
      const eventId = await resolveEventId(input)
      await guard(() => client().then((value) => value.deleteCalendarEvent({
        calendarId: input.providerCalendarId,
        eventId,
        ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
      })))
    },

    async respondToEvent(input) {
      const eventId = await resolveEventId(input)
      const responseAction = input.response === 'accepted' ? 'accept' : input.response === 'declined' ? 'decline' : 'tentativelyAccept'
      await guard(() => client().then((value) => value.respondToCalendarEvent({
        calendarId: input.providerCalendarId,
        eventId,
        response: responseAction,
        ...(input.comment ? { comment: input.comment } : {}),
      })))
    },

    async getAvailability(input: CalendarAvailabilityInput): Promise<{ busy: CalendarBusyInterval[] }> {
      if (!capabilities.availability) throw unavailableAvailability()
      const calendarOwners = await Promise.all(input.providerCalendarIds.map(async (calendarId) => {
        const raw = await guard(() => client().then((value) => value.getCalendar(calendarId)))
        const calendar = parseOrThrow(GraphCalendarSchema, raw, 'a calendar')
        const address = calendar.owner?.emailAddress?.address ?? (calendar.isDefaultCalendar ? account.emailAddress : null)
        if (!address) throw new CalendarCapabilityError('availability', 'Microsoft Graph cannot report availability for a calendar without an owner address.')
        return { calendarId, address: address.toLowerCase() }
      }))
      const raw = await guard(() => client().then((value) => value.getSchedule({
        schedules: [...new Set(calendarOwners.map((owner) => owner.address))],
        startTime: toGraphDateTime(input.startsAt),
        endTime: toGraphDateTime(input.endsAt),
        availabilityViewInterval: 30,
      })))
      const schedule = parseOrThrow(GraphScheduleSchema, raw, 'availability data')
      const idsByAddress = new Map<string, string[]>()
      for (const owner of calendarOwners) idsByAddress.set(owner.address, [...(idsByAddress.get(owner.address) ?? []), owner.calendarId])
      const busy: CalendarBusyInterval[] = []
      for (const result of schedule.value ?? []) {
        const calendarIds = idsByAddress.get(result.scheduleId.toLowerCase()) ?? []
        for (const item of result.scheduleItems ?? []) {
          if (item.status === 'free') continue
          for (const providerCalendarId of calendarIds) busy.push({
            providerCalendarId,
            startsAt: toDate(item.start.dateTime, item.start.timeZone),
            endsAt: toDate(item.end.dateTime, item.end.timeZone),
          })
        }
      }
      return { busy }
    },
  }
}
