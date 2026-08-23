// Durable calendar projection. Providers remain authoritative; this module only
// persists their inventory and event snapshots behind a tenant-scoped boundary.

import prisma from '../../db.js'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import type { CalendarEvent as ProviderEvent, CalendarProvider } from './CalendarProvider.js'
import { CalendarCursorExpiredError } from './calendarErrors.js'

type Db = Pick<PrismaClient, '$transaction' | 'oAuthConnection' | 'calendarSource' | 'calendarEvent' | 'calendarEventAttendee'>
type Tx = Prisma.TransactionClient

export type CalendarSyncScope = {
  orgId: string
  userId: string
  connectionId: string
}

export type CalendarSourceSyncInput = CalendarSyncScope & { sourceId: string }

const sourceScope = ({ orgId, userId, connectionId }: CalendarSyncScope) => ({ orgId, userId, connectionId })

/**
 * Refresh the complete provider calendar inventory for one connected account.
 * A rediscovered calendar updates provider-owned facts without replacing the
 * user's explicit secondary-calendar selection.
 */
export async function syncCalendarInventory(
  scope: CalendarSyncScope,
  provider: CalendarProvider,
  db: Db = prisma,
) {
  const connection = await db.oAuthConnection.findFirst({
    where: { id: scope.connectionId, orgId: scope.orgId, userId: scope.userId, provider: provider.provider },
    select: { id: true },
  })
  if (!connection) return []

  const calendars = [] as Awaited<ReturnType<CalendarProvider['listCalendars']>>['calendars']
  let cursor: string | null = null
  do {
    const page = await provider.listCalendars(cursor, 100)
    calendars.push(...page.calendars)
    cursor = page.nextCursor
  } while (cursor !== null)

  return db.$transaction(async (tx) => {
    const sources = []
    for (const calendar of calendars) {
      const existing = await tx.calendarSource.findFirst({
        where: { ...sourceScope(scope), providerCalendarId: calendar.providerCalendarId },
        select: { id: true },
      })
      const data = {
        provider: provider.provider,
        name: calendar.name,
        description: calendar.description,
        timeZone: calendar.timeZone,
        accessRole: calendar.accessRole,
        isPrimary: calendar.isPrimary,
      }
      if (existing) {
        await tx.calendarSource.updateMany({ where: { id: existing.id, ...sourceScope(scope) }, data })
        sources.push(await tx.calendarSource.findFirstOrThrow({ where: { id: existing.id, ...sourceScope(scope) } }))
      } else {
        sources.push(await tx.calendarSource.create({
          data: { ...sourceScope(scope), providerCalendarId: calendar.providerCalendarId, ...data },
        }))
      }
    }
    return sources
  })
}

/** Primary calendars are always visible; selected is the explicit secondary opt-in. */
export function listSelectedCalendarSources(orgId: string, userId: string, db: Db = prisma) {
  return db.calendarSource.findMany({
    where: { orgId, userId, OR: [{ isPrimary: true }, { isSelected: true }] },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  })
}

/** Returns false without changing anything when the source is not owned by this user. */
export async function setCalendarSourceSelected(
  sourceId: string,
  orgId: string,
  userId: string,
  isSelected: boolean,
  db: Db = prisma,
): Promise<boolean> {
  const result = await db.calendarSource.updateMany({ where: { id: sourceId, orgId, userId }, data: { isSelected } })
  return result.count === 1
}

function allDayDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Calendar provider returned an invalid all-day date.')
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function eventData(event: ProviderEvent, source: { timeZone: string | null }) {
  const recurrence = event.recurrence.kind === 'series'
    ? {
        recurrenceKind: 'series',
        providerSeriesId: event.recurrence.providerSeriesId,
        recurrenceRule: event.recurrence.recurrenceRule,
        originalStartAt: event.recurrence.originalStart instanceof Date ? event.recurrence.originalStart : null,
        originalStartDate: typeof event.recurrence.originalStart === 'string' ? event.recurrence.originalStart : null,
      }
    : { recurrenceKind: 'none', providerSeriesId: null, recurrenceRule: null, originalStartAt: null, originalStartDate: null }
  const time = event.kind === 'timed'
    ? { kind: 'timed', startsAt: event.startsAt, endsAt: event.endsAt, timeZone: source.timeZone }
    : { kind: 'all-day', startsAt: allDayDate(event.startDate), endsAt: allDayDate(event.endDateExclusive), timeZone: null }

  return {
    providerVersion: event.version,
    iCalUid: event.iCalUid,
    title: event.title,
    description: event.description,
    location: event.location,
    webLink: event.webLink,
    status: event.status,
    cancelledAt: event.status === 'cancelled' ? new Date() : null,
    ...time,
    ...recurrence,
  }
}

async function persistEvent(tx: Tx, scope: CalendarSyncScope, source: { id: string; timeZone: string | null }, event: ProviderEvent) {
  const existing = await tx.calendarEvent.findFirst({
    where: { ...sourceScope(scope), sourceId: source.id, providerEventId: event.providerEventId },
    select: { id: true },
  })
  const data = eventData(event, source)
  const stored = existing
    ? await (async () => {
        await tx.calendarEvent.updateMany({ where: { id: existing.id, ...sourceScope(scope), sourceId: source.id }, data })
        return tx.calendarEvent.findFirstOrThrow({ where: { id: existing.id, ...sourceScope(scope), sourceId: source.id } })
      })()
    : await tx.calendarEvent.create({
        data: { ...sourceScope(scope), sourceId: source.id, providerEventId: event.providerEventId, ...data },
      })

  const attendees = event.attendees.map((attendee) => ({ ...attendee, email: attendee.email.trim().toLowerCase() }))
  const emails = attendees.map((attendee) => attendee.email)
  await tx.calendarEventAttendee.deleteMany({
    where: { ...sourceScope(scope), eventId: stored.id, email: { notIn: emails } },
  })
  for (const attendee of attendees) {
    const existingAttendee = await tx.calendarEventAttendee.findFirst({
      where: { ...sourceScope(scope), eventId: stored.id, email: attendee.email },
      select: { id: true },
    })
    const attendeeData = {
      name: attendee.name ?? null,
      isOptional: attendee.isOptional,
      isResource: attendee.isResource,
      response: attendee.response,
    }
    if (existingAttendee) {
      await tx.calendarEventAttendee.updateMany({
        where: { id: existingAttendee.id, ...sourceScope(scope), eventId: stored.id },
        data: attendeeData,
      })
    } else {
      await tx.calendarEventAttendee.create({
        data: { ...sourceScope(scope), eventId: stored.id, email: attendee.email, ...attendeeData },
      })
    }
  }
}

/**
 * Persist one provider page. The provider's continuation/delta cursor is opaque,
 * so each call commits its page and checkpoint together. A cursor-expiry response
 * retries exactly once from a fresh page, rather than silently losing the state.
 */
export async function syncCalendarSource(
  input: CalendarSourceSyncInput,
  provider: CalendarProvider,
  db: Db = prisma,
): Promise<{ events: number; nextCursor: string | null; recovered: boolean } | null> {
  const scope = sourceScope(input)
  const source = await db.calendarSource.findFirst({ where: { id: input.sourceId, ...scope, provider: provider.provider } })
  if (!source) return null

  let recovered = false
  let page: Awaited<ReturnType<CalendarProvider['listEvents']>>
  try {
    page = await provider.listEvents({ providerCalendarId: source.providerCalendarId, cursor: source.syncCursor, limit: 100 })
  } catch (error) {
    if (!(error instanceof CalendarCursorExpiredError) || source.syncCursor === null) throw error
    recovered = true
    page = await provider.listEvents({ providerCalendarId: source.providerCalendarId, cursor: null, limit: 100 })
  }

  await db.$transaction(async (tx) => {
    for (const event of page.events) await persistEvent(tx, input, source, event)
    await tx.calendarSource.updateMany({
      where: { id: source.id, ...scope },
      data: { syncCursor: page.nextCursor, lastSyncedAt: new Date() },
    })
  })
  return { events: page.events.length, nextCursor: page.nextCursor, recovered }
}
