/**
 * Calendar workspace routes. The synchronized CalendarSource/Event projection is
 * the read model; provider calls are limited to explicit lifecycle commands.
 */
import { Router, type Response } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { dedupeLinkTargets, verifyLinkTargets } from '../crm/workLinks.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { googleCalendar } from '../lib/calendar/googleCalendar.js'
import { microsoftCalendar } from '../lib/calendar/microsoftCalendar.js'
import { saveCalendarEventMetadata } from '../lib/calendar/calendarEventMetadata.js'
import { persistCalendarEventSnapshot, syncCalendarInventory, syncCalendarSource } from '../lib/calendar/calendarSync.js'
import { getHealthyPrimaryMailbox, NoHealthyPrimaryMailboxError, type HealthyPrimaryMailbox } from '../lib/mail/mailAccounts.js'
import {
  CalendarApiError,
  CalendarAuthError,
  CalendarCapabilityError,
  CalendarRateLimitedError,
  CalendarVersionConflictError,
} from '../lib/calendar/calendarErrors.js'
import type { CalendarEventPatch, CalendarProvider, CreateCalendarEventInput, RecurrenceScope } from '../lib/calendar/CalendarProvider.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const sourceSelect = {
  id: true, provider: true, providerCalendarId: true, name: true, description: true,
  timeZone: true, accessRole: true, isPrimary: true, isSelected: true, lastSyncedAt: true,
  connectionId: true, orgId: true, userId: true,
  connection: { select: { emailAddress: true } },
} satisfies Prisma.CalendarSourceSelect

const eventInclude = {
  attendees: { orderBy: { email: 'asc' as const } },
  links: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  source: { select: { id: true, name: true, provider: true } },
} satisfies Prisma.CalendarEventInclude

const responseSchema = z.enum(['accepted', 'declined', 'tentative'])
const scopeSchema = z.enum(['this-event', 'this-and-following', 'series']).default('this-event')
const linkSchema = z.object({ object: z.string().trim().min(1).max(100), id: z.string().trim().min(1).max(200) })
const timeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}, 'Provide a valid IANA timezone.')
const meetingLinkSchema = z.string().trim().max(2_000).url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}, 'Provide an http or https meeting link.')
const attendeeSchema = z.object({
  email: z.string().trim().email().max(320), name: z.string().trim().max(200).optional(),
  isOptional: z.boolean().default(false), isResource: z.boolean().default(false),
  response: z.enum(['needs-action', 'accepted', 'declined', 'tentative']).default('needs-action'),
})
const timedSchema = z.object({ kind: z.literal('timed'), startsAt: z.coerce.date(), endsAt: z.coerce.date() })
const allDaySchema = z.object({ kind: z.literal('all-day'), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDateExclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
const timeSchema = z.discriminatedUnion('kind', [timedSchema, allDaySchema])
const recurrenceSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('series'), providerSeriesId: z.string().trim().min(1), recurrenceRule: z.string().trim().min(1), originalStart: z.union([z.coerce.date(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable() }),
])
const eventFieldsSchema = z.object({
  title: z.string().trim().max(500).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  attendees: z.array(attendeeSchema).max(500).optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  recurrence: recurrenceSchema.optional(),
  availability: z.enum(['busy', 'free']).optional(),
  privacy: z.enum(['default', 'public', 'private']).optional(),
  meetingLink: meetingLinkSchema.nullable().optional(),
  timeZone: timeZoneSchema.nullable().optional(),
  links: z.array(linkSchema).max(50).optional(),
})
const createSchema = eventFieldsSchema.extend({
  sourceId: z.string().trim().min(1),
  attendees: z.array(attendeeSchema).max(500).default([]),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
  recurrence: recurrenceSchema.default({ kind: 'none' }),
  availability: z.enum(['busy', 'free']).default('busy'),
  privacy: z.enum(['default', 'public', 'private']).default('default'),
  links: z.array(linkSchema).max(50).default([]),
  time: timeSchema,
})
const patchSchema = z.object({
  expectedVersion: z.string().nullable(), scope: scopeSchema,
  patch: eventFieldsSchema.extend({ time: timeSchema.optional() }),
})
const listSchema = z.object({
  startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50),
})
const availabilitySchema = z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date() })

function serializeSource(source: Prisma.CalendarSourceGetPayload<{ select: typeof sourceSelect }>) {
  const capabilities = providerFor(source).capabilities
  return {
    id: source.id, provider: source.provider, providerCalendarId: source.providerCalendarId,
    name: source.name, description: source.description, timeZone: source.timeZone,
    accessRole: source.accessRole, isPrimary: source.isPrimary, isSelected: source.isSelected,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    capabilities: {
      recurrence: capabilities.recurrence,
      rsvp: capabilities.rsvp,
      availability: capabilities.availability,
    },
    recurrenceScopes: source.provider === 'microsoft'
      ? ['this-event', 'series']
      : ['this-event', 'this-and-following', 'series'],
  }
}

type CalendarEventRow = Prisma.CalendarEventGetPayload<{ include: typeof eventInclude }>

function serializeEvent(event: CalendarEventRow) {
  return {
    id: event.id, sourceId: event.sourceId, providerEventId: event.providerEventId,
    providerVersion: event.providerVersion, title: event.title, description: event.description,
    location: event.location, webLink: event.webLink,
    meetingLink: event.meetingLinkOverride ?? event.meetingLink, kind: event.kind,
    startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
    timeZone: event.timeZoneOverride ?? event.timeZone, availability: event.availability,
    privacy: event.privacy, status: event.status, recurrenceKind: event.recurrenceKind,
    providerSeriesId: event.providerSeriesId, recurrenceRule: event.recurrenceRule,
    originalStartAt: event.originalStartAt?.toISOString() ?? null,
    originalStartDate: event.originalStartDate,
    attendees: event.attendees.map((attendee) => ({
      email: attendee.email, name: attendee.name, isOptional: attendee.isOptional,
      isResource: attendee.isResource, response: attendee.response,
    })),
    links: event.links.map((link) => ({ object: link.toObject, id: link.toId })),
    source: { id: event.source.id, name: event.source.name, provider: event.source.provider },
  }
}

function providerFor(source: Prisma.CalendarSourceGetPayload<{ select: typeof sourceSelect }>): CalendarProvider {
  if (source.provider === 'google') return googleCalendar({ connectionId: source.connectionId, emailAddress: source.connection.emailAddress })
  if (source.provider === 'microsoft') return microsoftCalendar({ connectionId: source.connectionId, emailAddress: source.connection.emailAddress, accountType: 'unknown' })
  throw new CalendarCapabilityError('calendar', 'This connected account does not support Calendar.')
}

function providerForAccount(account: HealthyPrimaryMailbox): CalendarProvider {
  if (account.provider === 'google') return googleCalendar({ connectionId: account.connectionId, emailAddress: account.emailAddress })
  if (account.provider === 'microsoft') return microsoftCalendar({ connectionId: account.connectionId, emailAddress: account.emailAddress, accountType: 'unknown' })
  throw new CalendarCapabilityError('calendar', 'This connected account does not support Calendar.')
}

async function currentCalendarAccount(orgId: string, userId: string): Promise<HealthyPrimaryMailbox | null> {
  try {
    return await getHealthyPrimaryMailbox(orgId, userId)
  } catch (error) {
    if (error instanceof NoHealthyPrimaryMailboxError) return null
    throw error
  }
}

function respondNotConnected(res: Response): void {
  res.status(409).json({ error: 'Reconnect Calendar in Settings → Integrations.', code: 'calendar_not_connected' })
}

function respondProjectionStale(
  res: Response,
  source: { provider: string },
  savedObject: 'this event' | 'this change' | 'this response',
): void {
  const providerName = source.provider === 'microsoft' ? 'Microsoft' : 'Google'
  res.status(502).json({
    error: `${providerName} saved ${savedObject}, but Maincar could not refresh it. Refresh Calendar before trying again.`,
    code: 'calendar_projection_stale',
  })
}

function respondProviderError(res: Response, error: unknown): boolean {
  if (error instanceof CalendarVersionConflictError) { res.status(409).json({ error: error.message, code: 'calendar_version_conflict' }); return true }
  if (error instanceof CalendarRateLimitedError) { if (error.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000))); res.status(429).json({ error: 'Calendar is temporarily rate limited. Try again shortly.', code: 'calendar_rate_limited' }); return true }
  if (error instanceof CalendarAuthError) { res.status(502).json({ error: 'Calendar authorization failed. Reconnect the account in Settings → Integrations.', code: 'calendar_auth_failed' }); return true }
  if (error instanceof CalendarCapabilityError) { res.status(422).json({ error: error.message, code: 'calendar_capability_unavailable' }); return true }
  if (error instanceof CalendarApiError) { res.status(502).json({ error: 'Calendar could not complete that action. Try again shortly.', code: 'calendar_provider_error' }); return true }
  return false
}

async function ownedSource(sourceId: string, orgId: string, userId: string, connectionId: string) {
  return prisma.calendarSource.findFirst({ where: { id: sourceId, orgId, userId, connectionId }, select: sourceSelect })
}

function loadEvent(eventId: string, orgId: string, userId: string, connectionId: string) {
  return prisma.calendarEvent.findFirst({ where: { id: eventId, orgId, userId, connectionId }, include: eventInclude })
}

router.get('/sources', wrapRoute('GET /api/calendar/orgs/:orgId/sources', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const userId = authReq.user!.id
  const account = await currentCalendarAccount(orgId, userId)
  if (!account) return void res.json({ calendar: { state: 'not-connected' }, sources: [] })
  const where = { orgId, userId, connectionId: account.connectionId }
  let sources = await prisma.calendarSource.findMany({ where, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], select: sourceSelect })
  if (!sources.length) {
    try {
      await syncCalendarInventory({ orgId, userId, connectionId: account.connectionId }, providerForAccount(account))
      sources = await prisma.calendarSource.findMany({ where, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], select: sourceSelect })
      for (const source of sources.filter((item) => item.isPrimary)) {
        await syncCalendarSource({ orgId, userId, connectionId: account.connectionId, sourceId: source.id }, providerFor(source))
      }
    } catch (error) {
      if (respondProviderError(res, error)) return
      throw error
    }
  }
  res.json({ calendar: { state: sources.length ? 'connected' : 'not-connected' }, sources: sources.map(serializeSource) })
}))

router.patch('/sources/:sourceId', wrapRoute('PATCH /api/calendar/orgs/:orgId/sources/:sourceId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId); const sourceId = String(req.params.sourceId)
  if (!await requireMembership(authReq, res, orgId)) return
  const userId = authReq.user!.id
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const parsed = z.object({ isSelected: z.boolean() }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: 'Provide isSelected as a boolean.' })
  const changed = await prisma.calendarSource.updateMany({ where: { id: sourceId, orgId, userId, connectionId: account.connectionId }, data: { isSelected: parsed.data.isSelected } })
  if (changed.count === 0) return void res.status(404).json({ error: 'Calendar source not found' })
  const source = await ownedSource(sourceId, orgId, userId, account.connectionId); if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  res.json({ source: serializeSource(source) })
}))

router.get('/sources/:sourceId/availability', wrapRoute('GET /api/calendar/orgs/:orgId/sources/:sourceId/availability', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const userId = authReq.user!.id
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const parsed = availabilitySchema.safeParse(req.query ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  if (parsed.data.endsAt <= parsed.data.startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  const source = await ownedSource(String(req.params.sourceId), orgId, userId, account.connectionId)
  if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  const provider = providerFor(source)
  if (!provider.capabilities.availability) {
    const providerName = source.provider === 'microsoft' ? 'Microsoft' : 'Google'
    return void res.json({ availability: { state: 'unavailable', reason: `Availability is not available for this connected ${providerName} account. Choose a time manually.` } })
  }
  try {
    const result = await provider.getAvailability({
      providerCalendarIds: [source.providerCalendarId],
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
    })
    res.json({
      availability: {
        state: 'available',
        busy: result.busy.map((interval) => ({
          sourceId: source.id,
          startsAt: interval.startsAt.toISOString(),
          endsAt: interval.endsAt.toISOString(),
        })),
      },
    })
  } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.get('/events', wrapRoute('GET /api/calendar/orgs/:orgId/events', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = listSchema.safeParse(req.query ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const { startsAt, endsAt, q, page, limit } = parsed.data; if (startsAt && endsAt && endsAt <= startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  const userId = authReq.user!.id
  const account = await currentCalendarAccount(orgId, userId)
  if (!account) return void res.json({ calendar: { state: 'not-connected' }, events: [], total: 0, page, limit })
  const sources = await prisma.calendarSource.findMany({ where: { orgId, userId, connectionId: account.connectionId, OR: [{ isPrimary: true }, { isSelected: true }] }, select: { id: true } })
  if (!sources.length) return void res.json({ calendar: { state: 'not-connected' }, events: [], total: 0, page, limit })
  const range: Prisma.CalendarEventWhereInput = startsAt && endsAt
    ? { AND: [{ startsAt: { lt: endsAt } }, { endsAt: { gt: startsAt } }] }
    : startsAt ? { endsAt: { gt: startsAt } } : endsAt ? { startsAt: { lt: endsAt } } : {}
  const where: Prisma.CalendarEventWhereInput = { orgId, userId, connectionId: account.connectionId, sourceId: { in: sources.map((source) => source.id) }, status: { not: 'cancelled' }, ...range, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } }] } : {}) }
  const [total, events] = await Promise.all([prisma.calendarEvent.count({ where }), prisma.calendarEvent.findMany({ where, orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * limit, take: limit, include: eventInclude })])
  res.json({ calendar: { state: 'connected' }, events: events.map(serializeEvent), total, page, limit })
}))

router.post('/sources/:sourceId/sync', wrapRoute('POST /api/calendar/orgs/:orgId/sources/:sourceId/sync', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const userId = authReq.user!.id
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const source = await ownedSource(String(req.params.sourceId), orgId, userId, account.connectionId)
  if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  try { const result = await syncCalendarSource({ orgId, userId, connectionId: source.connectionId, sourceId: source.id }, providerFor(source)); res.json({ sync: result }) } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.post('/events', wrapRoute('POST /api/calendar/orgs/:orgId/events', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId); const userId = authReq.user!.id
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = createSchema.safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  if (parsed.data.time.kind === 'timed' && parsed.data.time.endsAt <= parsed.data.time.startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  if (parsed.data.time.kind === 'all-day' && parsed.data.time.endDateExclusive <= parsed.data.time.startDate) return void res.status(400).json({ error: 'endDateExclusive must be after startDate.' })
  const links = dedupeLinkTargets(parsed.data.links)
  const badTarget = await verifyLinkTargets(prisma, orgId, links)
  if (badTarget) return void res.status(422).json({ error: badTarget })
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const source = await ownedSource(parsed.data.sourceId, orgId, userId, account.connectionId); if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  const { sourceId: _sourceId, meetingLink, timeZone, links: _links, time, ...providerFields } = parsed.data
  const providerTime = time.kind === 'timed' ? { ...time, timeZone } : time
  const createInput = { ...providerFields, providerCalendarId: source.providerCalendarId, ...providerTime } as CreateCalendarEventInput
  let providerSaved = false
  try {
    const created = await providerFor(source).createEvent(createInput)
    providerSaved = true
    const stored = await persistCalendarEventSnapshot({ orgId, userId, connectionId: source.connectionId, sourceId: source.id }, created)
    if (!stored) throw new Error('Calendar event projection could not be saved.')
    await saveCalendarEventMetadata({ orgId, userId, eventId: stored.id, meetingLink, timeZone, links })
    const event = await loadEvent(stored.id, orgId, userId, account.connectionId)
    if (!event) throw new Error('Calendar event projection could not be loaded.')
    res.status(201).json({ event: serializeEvent(event) })
  } catch (error) {
    if (respondProviderError(res, error)) return
    if (providerSaved) return void respondProjectionStale(res, source, 'this event')
    throw error
  }
}))

router.patch('/events/:eventId', wrapRoute('PATCH /api/calendar/orgs/:orgId/events/:eventId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId); const userId = authReq.user!.id
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = patchSchema.safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  if (parsed.data.patch.time?.kind === 'timed' && parsed.data.patch.time.endsAt <= parsed.data.patch.time.startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  if (parsed.data.patch.time?.kind === 'all-day' && parsed.data.patch.time.endDateExclusive <= parsed.data.patch.time.startDate) return void res.status(400).json({ error: 'endDateExclusive must be after startDate.' })
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId, connectionId: account.connectionId }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  const { links: requestedLinks, meetingLink, timeZone, time, ...providerFields } = parsed.data.patch
  const links = requestedLinks === undefined ? undefined : dedupeLinkTargets(requestedLinks)
  if (links) {
    const badTarget = await verifyLinkTargets(prisma, orgId, links)
    if (badTarget) return void res.status(422).json({ error: badTarget })
  }
  const providerTime = time?.kind === 'timed' ? { ...time, timeZone } : time
  const providerPatch = { ...providerFields, ...(providerTime ? { time: providerTime } : {}) } as CalendarEventPatch
  let providerSaved = false
  try {
    let eventId = event.id
    if (Object.keys(providerPatch).length > 0) {
      const updated = await providerFor(event.source).updateEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, expectedVersion: parsed.data.expectedVersion, scope: parsed.data.scope as RecurrenceScope, patch: providerPatch })
      providerSaved = true
      const stored = await persistCalendarEventSnapshot({ orgId, userId, connectionId: event.source.connectionId, sourceId: event.source.id }, updated)
      if (!stored) throw new Error('Calendar event projection could not be saved.')
      eventId = stored.id
    }
    await saveCalendarEventMetadata({ orgId, userId, eventId, meetingLink, timeZone, links })
    const saved = await loadEvent(eventId, orgId, userId, account.connectionId)
    if (!saved) throw new Error('Calendar event projection could not be loaded.')
    res.json({ event: serializeEvent(saved) })
  } catch (error) {
    if (respondProviderError(res, error)) return
    if (providerSaved) return void respondProjectionStale(res, event.source, 'this change')
    throw error
  }
}))

router.delete('/events/:eventId', wrapRoute('DELETE /api/calendar/orgs/:orgId/events/:eventId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId); const userId = authReq.user!.id
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = z.object({ expectedVersion: z.string().nullable(), scope: scopeSchema }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: 'Provide expectedVersion and an optional scope.' })
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId, connectionId: account.connectionId }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  let providerSaved = false
  try {
    await providerFor(event.source).deleteEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, expectedVersion: parsed.data.expectedVersion, scope: parsed.data.scope as RecurrenceScope })
    providerSaved = true
    const changed = await prisma.calendarEvent.updateMany({ where: { id: event.id, orgId, userId, connectionId: account.connectionId }, data: { status: 'cancelled', cancelledAt: new Date() } })
    if (changed.count === 0) throw new Error('Calendar event projection could not be saved.')
    res.status(204).end()
  } catch (error) {
    if (respondProviderError(res, error)) return
    if (providerSaved) return void respondProjectionStale(res, event.source, 'this change')
    throw error
  }
}))

router.post('/events/:eventId/rsvp', wrapRoute('POST /api/calendar/orgs/:orgId/events/:eventId/rsvp', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const userId = authReq.user!.id
  const parsed = z.object({ response: responseSchema, scope: scopeSchema, comment: z.string().trim().max(2_000).optional() }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const account = await currentCalendarAccount(orgId, userId); if (!account) return void respondNotConnected(res)
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId, connectionId: account.connectionId }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  let providerSaved = false
  try {
    const provider = providerFor(event.source)
    await provider.respondToEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, response: parsed.data.response, scope: parsed.data.scope as RecurrenceScope, ...(parsed.data.comment ? { comment: parsed.data.comment } : {}) })
    providerSaved = true
    await syncCalendarSource({ orgId, userId, connectionId: event.source.connectionId, sourceId: event.source.id }, provider)
    res.status(204).end()
  } catch (error) {
    if (respondProviderError(res, error)) return
    if (providerSaved) return void respondProjectionStale(res, event.source, 'this response')
    throw error
  }
}))

export default router
