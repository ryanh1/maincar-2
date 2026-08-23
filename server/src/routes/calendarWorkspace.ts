/**
 * Calendar workspace routes. The synchronized CalendarSource/Event projection is
 * the read model; provider calls are limited to explicit lifecycle commands.
 */
import { Router, type Response } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { googleCalendar } from '../lib/calendar/googleCalendar.js'
import { microsoftCalendar } from '../lib/calendar/microsoftCalendar.js'
import { syncCalendarSource } from '../lib/calendar/calendarSync.js'
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

const responseSchema = z.enum(['accepted', 'declined', 'tentative'])
const scopeSchema = z.enum(['this-event', 'this-and-following', 'series']).default('this-event')
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
const createSchema = z.object({
  sourceId: z.string().trim().min(1), title: z.string().trim().max(500).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(), location: z.string().trim().max(500).nullable().optional(),
  attendees: z.array(attendeeSchema).max(500).default([]), status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
  recurrence: recurrenceSchema.default({ kind: 'none' }), time: timeSchema,
})
const patchSchema = z.object({
  expectedVersion: z.string().nullable(), scope: scopeSchema,
  patch: z.object({ title: z.string().trim().max(500).nullable().optional(), description: z.string().max(10_000).nullable().optional(), location: z.string().trim().max(500).nullable().optional(), attendees: z.array(attendeeSchema).max(500).optional(), status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(), recurrence: recurrenceSchema.optional(), time: timeSchema.optional() }),
})
const listSchema = z.object({
  startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50),
})

function serializeSource(source: Prisma.CalendarSourceGetPayload<{ select: typeof sourceSelect }>) {
  return { id: source.id, provider: source.provider, providerCalendarId: source.providerCalendarId, name: source.name, description: source.description, timeZone: source.timeZone, accessRole: source.accessRole, isPrimary: source.isPrimary, isSelected: source.isSelected, lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null }
}

type CalendarEventRow = Prisma.CalendarEventGetPayload<{ include: { attendees: true; source: { select: { id: true; name: true; provider: true } } } }>

function serializeEvent(event: CalendarEventRow) {
  return { id: event.id, sourceId: event.sourceId, providerEventId: event.providerEventId, providerVersion: event.providerVersion, title: event.title, description: event.description, location: event.location, webLink: event.webLink, kind: event.kind, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), timeZone: event.timeZone, status: event.status, recurrenceKind: event.recurrenceKind, providerSeriesId: event.providerSeriesId, recurrenceRule: event.recurrenceRule, originalStartAt: event.originalStartAt?.toISOString() ?? null, originalStartDate: event.originalStartDate, attendees: event.attendees.map((attendee) => ({ email: attendee.email, name: attendee.name, isOptional: attendee.isOptional, isResource: attendee.isResource, response: attendee.response })), source: { id: event.source.id, name: event.source.name, provider: event.source.provider } }
}

function providerFor(source: Prisma.CalendarSourceGetPayload<{ select: typeof sourceSelect }>): CalendarProvider {
  if (source.provider === 'google') return googleCalendar({ connectionId: source.connectionId, emailAddress: source.connection.emailAddress })
  if (source.provider === 'microsoft') return microsoftCalendar({ connectionId: source.connectionId, emailAddress: source.connection.emailAddress, accountType: 'unknown' })
  throw new CalendarCapabilityError('calendar', 'This connected account does not support Calendar.')
}

function respondProviderError(res: Response, error: unknown): boolean {
  if (error instanceof CalendarVersionConflictError) { res.status(409).json({ error: error.message, code: 'calendar_version_conflict' }); return true }
  if (error instanceof CalendarRateLimitedError) { if (error.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000))); res.status(429).json({ error: 'Calendar is temporarily rate limited. Try again shortly.', code: 'calendar_rate_limited' }); return true }
  if (error instanceof CalendarAuthError) { res.status(502).json({ error: 'Calendar authorization failed. Reconnect the account in Settings → Integrations.', code: 'calendar_auth_failed' }); return true }
  if (error instanceof CalendarCapabilityError) { res.status(422).json({ error: error.message, code: 'calendar_capability_unavailable' }); return true }
  if (error instanceof CalendarApiError) { res.status(502).json({ error: 'Calendar could not complete that action. Try again shortly.', code: 'calendar_provider_error' }); return true }
  return false
}

async function ownedSource(sourceId: string, orgId: string, userId: string) {
  return prisma.calendarSource.findFirst({ where: { id: sourceId, orgId, userId }, select: sourceSelect })
}

router.get('/sources', wrapRoute('GET /api/calendar/orgs/:orgId/sources', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const sources = await prisma.calendarSource.findMany({ where: { orgId, userId: authReq.user!.id }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], select: sourceSelect })
  res.json({ calendar: { state: sources.length ? 'connected' : 'not-connected' }, sources: sources.map(serializeSource) })
}))

router.patch('/sources/:sourceId', wrapRoute('PATCH /api/calendar/orgs/:orgId/sources/:sourceId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId); const sourceId = String(req.params.sourceId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = z.object({ isSelected: z.boolean() }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: 'Provide isSelected as a boolean.' })
  const changed = await prisma.calendarSource.updateMany({ where: { id: sourceId, orgId, userId: authReq.user!.id }, data: { isSelected: parsed.data.isSelected } })
  if (changed.count === 0) return void res.status(404).json({ error: 'Calendar source not found' })
  const source = await ownedSource(sourceId, orgId, authReq.user!.id); if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  res.json({ source: serializeSource(source) })
}))

router.get('/events', wrapRoute('GET /api/calendar/orgs/:orgId/events', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = listSchema.safeParse(req.query ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const { startsAt, endsAt, q, page, limit } = parsed.data; if (startsAt && endsAt && endsAt <= startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  const sources = await prisma.calendarSource.findMany({ where: { orgId, userId: authReq.user!.id, OR: [{ isPrimary: true }, { isSelected: true }] }, select: { id: true } })
  if (!sources.length) return void res.json({ calendar: { state: 'not-connected' }, events: [], total: 0, page, limit })
  const range: Prisma.CalendarEventWhereInput = startsAt && endsAt
    ? { AND: [{ startsAt: { lt: endsAt } }, { endsAt: { gt: startsAt } }] }
    : startsAt ? { endsAt: { gt: startsAt } } : endsAt ? { startsAt: { lt: endsAt } } : {}
  const where: Prisma.CalendarEventWhereInput = { orgId, userId: authReq.user!.id, sourceId: { in: sources.map((source) => source.id) }, status: { not: 'cancelled' }, ...range, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } }] } : {}) }
  const [total, events] = await Promise.all([prisma.calendarEvent.count({ where }), prisma.calendarEvent.findMany({ where, orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * limit, take: limit, include: { attendees: { orderBy: { email: 'asc' } }, source: { select: { id: true, name: true, provider: true } } } })])
  res.json({ calendar: { state: 'connected' }, events: events.map(serializeEvent), total, page, limit })
}))

router.post('/sources/:sourceId/sync', wrapRoute('POST /api/calendar/orgs/:orgId/sources/:sourceId/sync', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const source = await ownedSource(String(req.params.sourceId), orgId, authReq.user!.id)
  if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  try { const result = await syncCalendarSource({ orgId, userId: authReq.user!.id, connectionId: source.connectionId, sourceId: source.id }, providerFor(source)); res.json({ sync: result }) } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.post('/events', wrapRoute('POST /api/calendar/orgs/:orgId/events', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = createSchema.safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  if (parsed.data.time.kind === 'timed' && parsed.data.time.endsAt <= parsed.data.time.startsAt) return void res.status(400).json({ error: 'endsAt must be after startsAt.' })
  if (parsed.data.time.kind === 'all-day' && parsed.data.time.endDateExclusive <= parsed.data.time.startDate) return void res.status(400).json({ error: 'endDateExclusive must be after startDate.' })
  const source = await ownedSource(parsed.data.sourceId, orgId, authReq.user!.id); if (!source) return void res.status(404).json({ error: 'Calendar source not found' })
  const { sourceId: _sourceId, time, ...eventFields } = parsed.data
  const createInput = { ...eventFields, providerCalendarId: source.providerCalendarId, ...time } as unknown as CreateCalendarEventInput
  try { const created = await providerFor(source).createEvent(createInput); await syncCalendarSource({ orgId, userId: authReq.user!.id, connectionId: source.connectionId, sourceId: source.id }, providerFor(source)); res.status(201).json({ event: created }) } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.patch('/events/:eventId', wrapRoute('PATCH /api/calendar/orgs/:orgId/events/:eventId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = patchSchema.safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId: authReq.user!.id }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  try { const updated = await providerFor(event.source).updateEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, expectedVersion: parsed.data.expectedVersion, scope: parsed.data.scope as RecurrenceScope, patch: parsed.data.patch as CalendarEventPatch }); await syncCalendarSource({ orgId, userId: authReq.user!.id, connectionId: event.source.connectionId, sourceId: event.source.id }, providerFor(event.source)); res.json({ event: updated }) } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.delete('/events/:eventId', wrapRoute('DELETE /api/calendar/orgs/:orgId/events/:eventId', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = z.object({ expectedVersion: z.string().nullable(), scope: scopeSchema }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: 'Provide expectedVersion and an optional scope.' })
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId: authReq.user!.id }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  try { await providerFor(event.source).deleteEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, expectedVersion: parsed.data.expectedVersion, scope: parsed.data.scope as RecurrenceScope }); await syncCalendarSource({ orgId, userId: authReq.user!.id, connectionId: event.source.connectionId, sourceId: event.source.id }, providerFor(event.source)); res.status(204).end() } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

router.post('/events/:eventId/rsvp', wrapRoute('POST /api/calendar/orgs/:orgId/events/:eventId/rsvp', async (req, res) => {
  const authReq = req as AuthenticatedRequest; const orgId = String(req.params.orgId)
  if (!await requireMembership(authReq, res, orgId)) return
  const parsed = z.object({ response: responseSchema, scope: scopeSchema, comment: z.string().trim().max(2_000).optional() }).safeParse(req.body ?? {}); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const event = await prisma.calendarEvent.findFirst({ where: { id: String(req.params.eventId), orgId, userId: authReq.user!.id }, include: { source: { select: sourceSelect } } }); if (!event) return void res.status(404).json({ error: 'Calendar event not found' })
  try { await providerFor(event.source).respondToEvent({ providerCalendarId: event.source.providerCalendarId, providerEventId: event.providerEventId, response: parsed.data.response, scope: parsed.data.scope as RecurrenceScope, ...(parsed.data.comment ? { comment: parsed.data.comment } : {}) }); await syncCalendarSource({ orgId, userId: authReq.user!.id, connectionId: event.source.connectionId, sourceId: event.source.id }, providerFor(event.source)); res.status(204).end() } catch (error) { if (!respondProviderError(res, error)) throw error }
}))

export default router
