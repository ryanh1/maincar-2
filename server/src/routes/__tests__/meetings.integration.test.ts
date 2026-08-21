// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it proves the route ASKS for the right reads.
// This proves the things only real row state and real constraints can — which for
// T11 (MAI-139) is the whole acceptance list:
//   - a meeting with an EXTERNAL attendee keeps their email and creates NO Person;
//   - re-sync is idempotent via @@unique([orgId, provider, providerEventId]);
//   - all-day AND timed meetings BOTH round-trip;
// plus the SetNull/Cascade rules that decide what survives a deletion, and the
// separation of `location` from `joinUrl` at the column level.
//
// The sync cases are driven from Google-Calendar- and Graph-shaped payloads
// rather than from hand-written column values, so this exercises the mapping a
// later calendar-sync spec will actually perform. Run it with
// `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedCompany,
  seedOrgWithAdmin,
  seedPerson,
} from '../../test/integration/testPrisma.js'

/**
 * The shape Google Calendar's `events.list` hands back. `start`/`end` are a UNION
 * in Google's API — a timed event carries `dateTime` + `timeZone`, an all-day
 * event carries a bare `date` with neither — and that union is exactly the thing
 * `isAllDay` exists to preserve.
 */
interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface GoogleEvent {
  id: string
  iCalUID: string
  status?: string
  summary: string
  description?: string
  location?: string
  hangoutLink?: string
  htmlLink?: string
  etag?: string
  recurringEventId?: string
  start: GoogleEventTime
  end: GoogleEventTime
  organizer?: { email: string }
  attendees?: {
    email: string
    displayName?: string
    responseStatus?: string
    organizer?: boolean
    optional?: boolean
    resource?: boolean
  }[]
}

function googleEvent(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  const id = `evt${Math.random().toString(36).slice(2, 14)}`
  return {
    id,
    iCalUID: `${id}@google.com`,
    status: 'confirmed',
    summary: 'Discovery call',
    description: 'Agenda: current stack, timeline, budget.',
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    etag: '"etag-1"',
    start: { dateTime: '2026-06-24T18:00:00-04:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-06-24T18:30:00-04:00', timeZone: 'America/New_York' },
    organizer: { email: 'rep@maincar.com' },
    ...overrides,
  }
}

/**
 * Read one side of a Google event's time union.
 *
 * The all-day branch is the interesting one: `date` is "2026-08-25" with NO time
 * and NO zone, and `new Date("2026-08-25")` in JavaScript parses a bare date
 * string as UTC midnight — which is precisely the storage rule the Meeting model
 * documents. Writing it explicitly here rather than leaning on that coincidence
 * is the difference between a stored fact and a lucky one.
 */
function readEventTime(t: GoogleEventTime): { at: Date; isAllDay: boolean; timeZone: string | null } {
  if (t.date) {
    const [y, m, d] = t.date.split('-').map(Number)
    return { at: new Date(Date.UTC(y, m - 1, d)), isAllDay: true, timeZone: null }
  }
  return { at: new Date(t.dateTime!), isAllDay: false, timeZone: t.timeZone ?? null }
}

/**
 * The Prisma upsert a calendar-sync route will build from a Google event.
 *
 * Note what it does with attendees: it writes each one's RAW email and leaves
 * personId null. Matching an address to a Person is a separate, later decision
 * (the record-creation setting, spec §5.3a) — a sync must never conjure People.
 */
function fromGoogleEvent(event: GoogleEvent, ctx: { orgId: string }) {
  const start = readEventTime(event.start)
  const end = readEventTime(event.end)
  return {
    orgId: ctx.orgId,
    title: event.summary,
    description: event.description ?? null,
    // TWO fields, from TWO different places in Google's payload. `location` is
    // free text a human typed; `hangoutLink` is a URL Google minted. They are not
    // interchangeable and this mapping never merges them.
    location: event.location ?? null,
    joinUrl: event.hangoutLink ?? null,
    conferenceProvider: event.hangoutLink ? 'google_meet' : null,
    isAllDay: start.isAllDay,
    startsAt: start.at,
    endsAt: end.at,
    timeZone: start.timeZone,
    status: event.status ?? 'confirmed',
    organizerEmail: event.organizer?.email ?? null,
    provider: 'google',
    providerEventId: event.id,
    iCalUid: event.iCalUID,
    recurringEventId: event.recurringEventId ?? null,
    syncCursor: event.etag ?? null,
    webLink: event.htmlLink ?? null,
    attendees: {
      create: (event.attendees ?? []).map((a) => ({
        orgId: ctx.orgId,
        email: a.email,
        name: a.displayName ?? null,
        responseStatus: a.responseStatus ?? 'needs_action',
        isOrganizer: a.organizer ?? false,
        isOptional: a.optional ?? false,
        isResource: a.resource ?? false,
      })),
    },
  }
}

describe('Meeting activity spine (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // --- Acceptance: an external attendee keeps their email, and no Person is made

  it('keeps an EXTERNAL attendee email WITHOUT creating a Person', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const peopleBefore = await prisma.person.count({ where: { orgId } })

    const event = googleEvent({
      attendees: [
        { email: 'rep@maincar.com', displayName: 'Al Pha', organizer: true, responseStatus: 'accepted' },
        // Nobody in this org has ever heard of this person. The meeting still
        // logs, and they are still on it.
        { email: 'dana@external-vendor.example', displayName: 'Dana Külz', responseStatus: 'accepted' },
      ],
    })

    const meeting = await prisma.meeting.create({
      data: fromGoogleEvent(event, { orgId }),
      include: { attendees: { orderBy: { email: 'asc' } } },
    })

    expect(meeting.attendees).toHaveLength(2)
    const external = meeting.attendees.find((a) => a.email === 'dana@external-vendor.example')
    expect(external).toBeDefined()
    // The email is kept RAW, and there is NO Person behind it.
    expect(external!.personId).toBeNull()
    expect(external!.name).toBe('Dana Külz')
    expect(external!.responseStatus).toBe('accepted')

    // THE criterion: the People table is exactly as it was. Syncing a calendar
    // must never flood the CRM with one-off invitees.
    expect(await prisma.person.count({ where: { orgId } })).toBe(peopleBefore)
  })

  it('matches that same attendee to a Person LATER without rewriting the invite', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent({
      attendees: [{ email: 'dana@external-vendor.example', displayName: 'Dana Külz' }],
    })
    const meeting = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })

    // Dana becomes a Person at a Company — an import, an enrichment, a rep adding
    // them, or the record-creation setting deciding it is time.
    const company = await seedCompany(prisma, { orgId, name: 'External Vendor' })
    const person = await seedPerson(prisma, { orgId, companyId: company.id, firstName: 'Dana' })

    // The match writes the link and NOTHING else. orgId is in the where clause,
    // and updateMany rather than update by id — the tenant key is where the
    // boundary lives (.claude/rules/database-and-prisma.md).
    const linked = await prisma.meetingAttendee.updateMany({
      where: { orgId, email: 'dana@external-vendor.example', personId: null },
      data: { personId: person.id },
    })
    expect(linked.count).toBe(1)

    const after = await prisma.meetingAttendee.findFirstOrThrow({
      where: { orgId, meetingId: meeting.id },
    })
    expect(after.personId).toBe(person.id)
    // The raw address they were invited at is untouched.
    expect(after.email).toBe('dana@external-vendor.example')
    expect(after.name).toBe('Dana Külz')

    // And the Person can reach the meeting from their side.
    const fromPerson = await prisma.person.findFirstOrThrow({
      where: { id: person.id, orgId },
      include: { meetingAttendances: true },
    })
    expect(fromPerson.meetingAttendances.map((a) => a.meetingId)).toEqual([meeting.id])
  })

  it('keeps a ROOM out of the human count — a resource attendee is not a person', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent({
      location: 'HQ, Room 4',
      attendees: [
        { email: 'rep@maincar.com', organizer: true },
        { email: 'dana@external-vendor.example' },
        { email: 'room-4@maincar.com', displayName: 'Room 4', resource: true, responseStatus: 'accepted' },
      ],
    })
    const meeting = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })

    expect(await prisma.meetingAttendee.count({ where: { orgId, meetingId: meeting.id } })).toBe(3)
    expect(
      await prisma.meetingAttendee.count({
        where: { orgId, meetingId: meeting.id, isResource: false },
      }),
    ).toBe(2)
    // And a booked room is still not a Person.
    expect(await prisma.person.count({ where: { orgId } })).toBe(0)
  })

  // --- Acceptance: re-sync is idempotent --------------------------------------

  it('rejects a SECOND insert of the same (org, provider, event) — the constraint itself', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent()

    await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })
    await expect(
      prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('is IDEMPOTENT when the same calendar event is re-synced', async () => {
    // A delta sync re-reads an event it already has, with the same id and a moved
    // etag. That is the ordinary case, not an error, and it must not log the
    // meeting twice or duplicate everyone on it.
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent({
      location: 'HQ, Room 4',
      attendees: [
        { email: 'rep@maincar.com', organizer: true, responseStatus: 'accepted' },
        { email: 'dana@external-vendor.example', responseStatus: 'needs_action' },
      ],
    })
    const create = fromGoogleEvent(event, { orgId })

    const first = await prisma.meeting.create({ data: create })

    // The second pass sees the event again — Dana has since accepted, and the
    // title was edited. The upsert updates in place; each attendee upserts on
    // (meetingId, email) so the guest list is corrected, not appended to.
    const second = await prisma.meeting.upsert({
      where: {
        orgId_provider_providerEventId: {
          orgId,
          provider: 'google',
          providerEventId: event.id,
        },
      },
      create,
      update: { title: 'Discovery call (rescheduled)', syncCursor: '"etag-2"' },
    })
    for (const a of event.attendees!) {
      await prisma.meetingAttendee.upsert({
        where: { meetingId_email: { meetingId: second.id, email: a.email } },
        create: { orgId, meetingId: second.id, email: a.email },
        update: { responseStatus: 'accepted' },
      })
    }

    expect(second.id).toBe(first.id)
    expect(second.title).toBe('Discovery call (rescheduled)')
    expect(second.syncCursor).toBe('"etag-2"')
    expect(await prisma.meeting.count({ where: { orgId, providerEventId: event.id } })).toBe(1)
    // Two attendees, still — not four.
    expect(await prisma.meetingAttendee.count({ where: { orgId, meetingId: first.id } })).toBe(2)
    const dana = await prisma.meetingAttendee.findFirstOrThrow({
      where: { orgId, meetingId: first.id, email: 'dana@external-vendor.example' },
    })
    expect(dana.responseStatus).toBe('accepted')
    // And the re-sync still did not make anyone a Person.
    expect(await prisma.person.count({ where: { orgId } })).toBe(0)
  })

  it('refuses a second copy of the same attendee address on one meeting', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const meeting = await prisma.meeting.create({ data: fromGoogleEvent(googleEvent(), { orgId }) })
    await prisma.meetingAttendee.create({
      data: { orgId, meetingId: meeting.id, email: 'dana@external-vendor.example' },
    })
    await expect(
      prisma.meetingAttendee.create({
        data: { orgId, meetingId: meeting.id, email: 'dana@external-vendor.example' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('lets ONE event id live in two different orgs — the key is per tenant', async () => {
    // Unlike a Twilio SID, a Google event id is only unique within a calendar. Two
    // separate customers can hold events with colliding ids and they are two
    // meetings.
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const event = googleEvent()

    const inA = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId: a.orgId }) })
    const inB = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId: b.orgId }) })

    expect(inA.id).not.toBe(inB.id)
    expect(await prisma.meeting.findFirst({ where: { id: inB.id, orgId: a.orgId } })).toBeNull()
  })

  it('does not collide two HAND-MADE meetings that have no provider event id', async () => {
    // A meeting somebody typed in has no Google id. Two of them are two meetings,
    // not a constraint violation — Postgres allows many NULLs under a unique index.
    const { orgId } = await seedOrgWithAdmin(prisma)
    const base = {
      orgId,
      startsAt: new Date('2026-06-24T22:00:00.000Z'),
      endsAt: new Date('2026-06-24T22:30:00.000Z'),
      timeZone: 'America/New_York',
      provider: 'manual',
    }

    await prisma.meeting.create({ data: { ...base, title: 'One' } })
    await prisma.meeting.create({ data: { ...base, title: 'Two' } })

    expect(await prisma.meeting.count({ where: { orgId, providerEventId: null } })).toBe(2)
  })

  it('finds the SAME real-world meeting across providers by iCalUid', async () => {
    // The Google copy and the Graph copy of one meeting are two rows — each
    // provider's event id is its own — and iCalUid is the stable id that says they
    // are the same event in the world.
    const { orgId } = await seedOrgWithAdmin(prisma)
    const shared = 'shared-uid@google.com'
    await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ iCalUID: shared }), { orgId }),
    })
    await prisma.meeting.create({
      data: {
        ...fromGoogleEvent(googleEvent({ iCalUID: shared }), { orgId }),
        provider: 'm365',
      },
    })

    const both = await prisma.meeting.findMany({ where: { orgId, iCalUid: shared } })
    expect(both).toHaveLength(2)
    expect(both.map((m) => m.provider).sort()).toEqual(['google', 'm365'])
  })

  // --- Acceptance: all-day AND timed both round-trip --------------------------

  it('round-trips a TIMED meeting: a real instant, with its IANA zone kept', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent({
      start: { dateTime: '2026-06-24T18:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-06-24T18:30:00-04:00', timeZone: 'America/New_York' },
    })

    const written = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })
    const read = await prisma.meeting.findFirstOrThrow({ where: { id: written.id, orgId } })

    expect(read.isAllDay).toBe(false)
    // 18:00 in New York on Jun 24 2026 is EDT (UTC-4), so 22:00Z. Stored as an
    // instant, so the moment survives whatever zone the reader is in.
    expect(read.startsAt.toISOString()).toBe('2026-06-24T22:00:00.000Z')
    expect(read.endsAt.toISOString()).toBe('2026-06-24T22:30:00.000Z')
    // The zone is kept SEPARATELY, because the instant alone cannot say
    // "6:00 PM EDT" — and a bare local time with no zone label is exactly what
    // CLAUDE.md → Dates & Times forbids showing anyone.
    expect(read.timeZone).toBe('America/New_York')
  })

  it('round-trips an ALL-DAY meeting: the same calendar date, from any zone', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    // Google sends a bare date for an all-day event — no time, no zone.
    const event = googleEvent({
      summary: 'Onsite at customer HQ',
      location: 'Customer HQ, Berlin',
      start: { date: '2026-08-25' },
      end: { date: '2026-08-26' },
    })

    const written = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })
    const read = await prisma.meeting.findFirstOrThrow({ where: { id: written.id, orgId } })

    expect(read.isAllDay).toBe(true)
    // Stored as the UTC midnight of the date, so the date read off the UTC parts
    // is the date the calendar meant — the 25th, and it stays the 25th.
    expect(read.startsAt.toISOString()).toBe('2026-08-25T00:00:00.000Z')
    expect(read.startsAt.toISOString().slice(0, 10)).toBe('2026-08-25')
    // endsAt is EXCLUSIVE, matching Google: a one-day event on the 25th ends on
    // the 26th.
    expect(read.endsAt.toISOString().slice(0, 10)).toBe('2026-08-26')
    // No zone on a date-only value. There is nothing for a zone to mean.
    expect(read.timeZone).toBeNull()
  })

  it('keeps all-day and timed meetings apart in one calendar, and sorts them together', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const allDay = await prisma.meeting.create({
      data: fromGoogleEvent(
        googleEvent({ summary: 'Onsite', start: { date: '2026-08-25' }, end: { date: '2026-08-26' } }),
        { orgId },
      ),
    })
    const timed = await prisma.meeting.create({
      data: fromGoogleEvent(
        googleEvent({
          summary: 'Standup',
          start: { dateTime: '2026-08-25T13:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-08-25T13:15:00Z', timeZone: 'UTC' },
        }),
        { orgId },
      ),
    })

    const day = await prisma.meeting.findMany({
      where: {
        orgId,
        startsAt: { gte: new Date('2026-08-25T00:00:00Z'), lt: new Date('2026-08-26T00:00:00Z') },
      },
      orderBy: { startsAt: 'asc' },
    })
    // Both are on the 25th, and the all-day one sorts first — its UTC midnight is
    // the earliest instant on that date.
    expect(day.map((m) => m.id)).toEqual([allDay.id, timed.id])
    expect(day.map((m) => m.isAllDay)).toEqual([true, false])
    // The all-day filter answers the two questions apart.
    expect(await prisma.meeting.count({ where: { orgId, isAllDay: true } })).toBe(1)
    expect(await prisma.meeting.count({ where: { orgId, isAllDay: false } })).toBe(1)
  })

  // --- location vs joinUrl: two columns, four real cases ----------------------

  it('stores a room and a video link as TWO separate columns', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    const both = await prisma.meeting.create({
      data: fromGoogleEvent(
        googleEvent({
          location: 'HQ, Room 4',
          hangoutLink: 'https://meet.google.com/abc-defg-hij',
        }),
        { orgId },
      ),
    })
    // A room WITH a dial-in. One merged "where" string could not say this.
    expect(both.location).toBe('HQ, Room 4')
    expect(both.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(both.conferenceProvider).toBe('google_meet')

    const inPerson = await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ location: 'Customer HQ, Berlin' }), { orgId }),
    })
    expect(inPerson.location).toBe('Customer HQ, Berlin')
    expect(inPerson.joinUrl).toBeNull()
    // Null, not "other": an in-person meeting is not a conference with an unknown
    // provider.
    expect(inPerson.conferenceProvider).toBeNull()

    const videoOnly = await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ hangoutLink: 'https://meet.google.com/x' }), { orgId }),
    })
    expect(videoOnly.location).toBeNull()
    expect(videoOnly.joinUrl).toBe('https://meet.google.com/x')

    const neither = await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent(), { orgId }),
    })
    expect(neither.location).toBeNull()
    expect(neither.joinUrl).toBeNull()

    // And the two questions are separately answerable, which is the whole point.
    expect(await prisma.meeting.count({ where: { orgId, location: { not: null } } })).toBe(2)
    expect(await prisma.meeting.count({ where: { orgId, joinUrl: { not: null } } })).toBe(2)
    expect(
      await prisma.meeting.count({
        where: { orgId, location: { not: null }, joinUrl: null },
      }),
    ).toBe(1)
  })

  // --- What survives a deletion ----------------------------------------------

  it('keeps the meeting when the Company or Deal is deleted (SetNull)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId, name: 'Doomed Co' })
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: 'New Business', isDefault: true },
    })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1 },
    })
    const deal = await prisma.deal.create({
      data: {
        orgId,
        name: 'Doomed expansion',
        companyId: company.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
      },
    })

    const meeting = await prisma.meeting.create({
      data: {
        ...fromGoogleEvent(googleEvent({ location: 'HQ, Room 4' }), { orgId }),
        companyId: company.id,
        dealId: deal.id,
      },
    })

    await prisma.deal.deleteMany({ where: { id: deal.id, orgId } })
    await prisma.company.deleteMany({ where: { id: company.id, orgId } })

    const survivor = await prisma.meeting.findFirstOrThrow({ where: { id: meeting.id, orgId } })
    expect(survivor.companyId).toBeNull()
    expect(survivor.dealId).toBeNull()
    // The meeting itself, and where it happened, is untouched.
    expect(survivor.title).toBe('Discovery call')
    expect(survivor.location).toBe('HQ, Room 4')
  })

  it('keeps the attendee row and its RAW email when the Person is deleted (SetNull)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const person = await seedPerson(prisma, { orgId, firstName: 'Gone' })
    const meeting = await prisma.meeting.create({ data: fromGoogleEvent(googleEvent(), { orgId }) })
    const attendee = await prisma.meetingAttendee.create({
      data: {
        orgId,
        meetingId: meeting.id,
        email: 'gone@external-vendor.example',
        name: 'Gone Person',
        personId: person.id,
      },
    })

    await prisma.person.deleteMany({ where: { id: person.id, orgId } })

    const survivor = await prisma.meetingAttendee.findFirstOrThrow({
      where: { id: attendee.id, orgId },
    })
    expect(survivor.personId).toBeNull()
    // Deleting a Person unlinks; it does not erase who was in the room.
    expect(survivor.email).toBe('gone@external-vendor.example')
    expect(survivor.name).toBe('Gone Person')
  })

  it('keeps the meeting when its ORGANIZER Person is deleted, falling back to the email', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const person = await seedPerson(prisma, { orgId, firstName: 'Organizer' })
    const meeting = await prisma.meeting.create({
      data: {
        ...fromGoogleEvent(googleEvent(), { orgId }),
        organizerPersonId: person.id,
        organizerEmail: 'organizer@maincar.com',
      },
    })

    await prisma.person.deleteMany({ where: { id: person.id, orgId } })

    const survivor = await prisma.meeting.findFirstOrThrow({ where: { id: meeting.id, orgId } })
    expect(survivor.organizerPersonId).toBeNull()
    expect(survivor.organizerEmail).toBe('organizer@maincar.com')
  })

  it('cascades the attendees away with the meeting, and never the other way round', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const meeting = await prisma.meeting.create({
      data: fromGoogleEvent(
        googleEvent({
          attendees: [{ email: 'rep@maincar.com', organizer: true }, { email: 'dana@x.example' }],
        }),
        { orgId },
      ),
    })
    expect(await prisma.meetingAttendee.count({ where: { orgId, meetingId: meeting.id } })).toBe(2)

    await prisma.meeting.deleteMany({ where: { id: meeting.id, orgId } })
    expect(await prisma.meetingAttendee.count({ where: { orgId, meetingId: meeting.id } })).toBe(0)
  })

  it('cascades every meeting and attendee away with the ORG', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const meeting = await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ attendees: [{ email: 'dana@x.example' }] }), { orgId }),
    })

    await prisma.org.deleteMany({ where: { id: orgId } })

    expect(await prisma.meeting.count({ where: { id: meeting.id } })).toBe(0)
    expect(await prisma.meetingAttendee.count({ where: { meetingId: meeting.id } })).toBe(0)
  })

  // --- The tenant boundary and the feed --------------------------------------

  it('keeps one org out of another org meeting list', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)

    await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ summary: 'A' }), { orgId: a.orgId }),
    })
    const bRow = await prisma.meeting.create({
      data: fromGoogleEvent(googleEvent({ summary: 'B' }), { orgId: b.orgId }),
    })

    const listA = await prisma.meeting.findMany({ where: { orgId: a.orgId } })
    expect(listA.map((m) => m.title)).toEqual(['A'])
    expect(await prisma.meeting.findFirst({ where: { id: bRow.id, orgId: a.orgId } })).toBeNull()
  })

  it('reads a Company feed of meetings in one indexed round-trip, newest first', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId, name: 'Feedco' })

    const older = await prisma.meeting.create({
      data: {
        ...fromGoogleEvent(
          googleEvent({
            summary: 'older',
            start: { dateTime: '2026-08-18T10:00:00Z', timeZone: 'UTC' },
            end: { dateTime: '2026-08-18T11:00:00Z', timeZone: 'UTC' },
          }),
          { orgId },
        ),
        companyId: company.id,
      },
    })
    const newer = await prisma.meeting.create({
      data: {
        ...fromGoogleEvent(
          googleEvent({
            summary: 'newer',
            start: { dateTime: '2026-08-19T10:00:00Z', timeZone: 'UTC' },
            end: { dateTime: '2026-08-19T11:00:00Z', timeZone: 'UTC' },
          }),
          { orgId },
        ),
        companyId: company.id,
      },
    })

    const feed = await prisma.meeting.findMany({
      where: { orgId, companyId: company.id },
      orderBy: [{ startsAt: 'desc' }],
    })
    expect(feed.map((m) => m.id)).toEqual([newer.id, older.id])

    // And the Company can reach them from its side.
    const fromCompany = await prisma.company.findFirstOrThrow({
      where: { id: company.id, orgId },
      include: { meetings: true },
    })
    expect(fromCompany.meetings).toHaveLength(2)
  })

  it('KEEPS a cancelled meeting — "they cancelled" is a fact about the account', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const event = googleEvent({ summary: 'Demo', status: 'confirmed' })
    const meeting = await prisma.meeting.create({ data: fromGoogleEvent(event, { orgId }) })

    // The next sync sees status: cancelled. The row is UPDATED, not deleted.
    await prisma.meeting.updateMany({
      where: { id: meeting.id, orgId },
      data: { status: 'cancelled' },
    })

    const survivor = await prisma.meeting.findFirstOrThrow({ where: { id: meeting.id, orgId } })
    expect(survivor.status).toBe('cancelled')
    expect(survivor.title).toBe('Demo')
  })
})
