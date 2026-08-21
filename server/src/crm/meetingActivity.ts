/**
 * meetingActivity — the type-safe half of the Meeting / MeetingAttendee string
 * columns, plus the row → API mappers the read routes use (MAI-139 T11; spec §6).
 *
 * The same pairing emailActivity.ts and smsActivity.ts use, for the same reason:
 * the database columns are plain `String`s, because a Postgres enum needs an
 * ALTER TYPE dance to gain a value and this schema WILL gain values — a new
 * conference provider appears roughly every year
 * (.claude/rules/database-and-prisma.md → No Enums). The unions below are the
 * other half: the allowed values written once, next to the guard that narrows an
 * unknown string to them.
 *
 * The mappers live here rather than in the route so the shape a client sees is
 * stated in ONE place and can be unit-tested without an HTTP round-trip. Four
 * rules they hold to:
 *
 *   1. `orgId` never leaves the server. It is the tenant boundary, and the caller
 *      already knows it — it is in the path they asked on.
 *   2. An attendee's `email` is ALWAYS returned, matched to a Person or not. The
 *      raw address is who was actually invited; a personId is a link we drew
 *      later, and drawing it must never replace what the invite said.
 *   3. `location` and `joinUrl` cross the wire as TWO fields, never merged into
 *      one "where". A room is not a video link — see the model comment in
 *      server/prisma/schema.prisma.
 *   4. A TIMED meeting always carries its zone; an ALL-DAY meeting never does.
 *      See `mapMeetingTimes` — this is where CLAUDE.md → Dates & Times is
 *      enforced, so no client has to remember it.
 */
import type { Meeting, MeetingAttendee } from '../generated/prisma/client.js'

// --- The string unions -------------------------------------------------------

/**
 * Where the meeting stands. `Meeting.status`.
 *
 * `cancelled` is a state, not a deletion: a cancelled meeting is KEPT, because
 * "they cancelled the demo" is a fact about the account that a feed should show.
 */
export const MEETING_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

/** Where the meeting was synced from. `Meeting.provider`. */
export const MEETING_PROVIDERS = ['google', 'm365', 'manual'] as const
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number]

/**
 * Which video product `joinUrl` points at. `Meeting.conferenceProvider`.
 *
 * Null — not `other` — when there is no video link at all: an in-person meeting
 * is not a conference with an unknown provider.
 */
export const CONFERENCE_PROVIDERS = ['google_meet', 'zoom', 'teams', 'other'] as const
export type ConferenceProvider = (typeof CONFERENCE_PROVIDERS)[number]

/**
 * How an invitee replied. `MeetingAttendee.responseStatus`.
 *
 * Google's vocabulary, which Graph's response types map onto. `needs_action` is
 * the default and is NOT the same as `tentative`: nobody answering is different
 * from somebody answering "maybe".
 */
export const ATTENDEE_RESPONSE_STATUSES = [
  'needs_action',
  'accepted',
  'declined',
  'tentative',
] as const
export type AttendeeResponseStatus = (typeof ATTENDEE_RESPONSE_STATUSES)[number]

/** Who captured the recording. `Meeting.recordingProvider`. PHASE 2 fill. */
export const RECORDING_PROVIDERS = ['recall_ai', 'gong', 'zoom'] as const
export type RecordingProvider = (typeof RECORDING_PROVIDERS)[number]

/** Where the transcript job got to. `Meeting.transcriptStatus`. PHASE 2 fill. */
export const TRANSCRIPT_STATUSES = ['pending', 'done', 'failed'] as const
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number]

export function isMeetingStatus(value: unknown): value is MeetingStatus {
  return typeof value === 'string' && (MEETING_STATUSES as readonly string[]).includes(value)
}

export function isMeetingProvider(value: unknown): value is MeetingProvider {
  return typeof value === 'string' && (MEETING_PROVIDERS as readonly string[]).includes(value)
}

export function isConferenceProvider(value: unknown): value is ConferenceProvider {
  return typeof value === 'string' && (CONFERENCE_PROVIDERS as readonly string[]).includes(value)
}

export function isAttendeeResponseStatus(value: unknown): value is AttendeeResponseStatus {
  return (
    typeof value === 'string' && (ATTENDEE_RESPONSE_STATUSES as readonly string[]).includes(value)
  )
}

export function isRecordingProvider(value: unknown): value is RecordingProvider {
  return typeof value === 'string' && (RECORDING_PROVIDERS as readonly string[]).includes(value)
}

export function isTranscriptStatus(value: unknown): value is TranscriptStatus {
  return typeof value === 'string' && (TRANSCRIPT_STATUSES as readonly string[]).includes(value)
}

// --- Times: the one place the all-day rule is enforced ------------------------

/**
 * The calendar date a stored instant stands for, read off its UTC parts —
 * "2026-08-25".
 *
 * UTC parts, deliberately, and never the process's local zone: an all-day event
 * is stored as the UTC midnight of its date (see the Meeting model comment), so
 * the UTC parts ARE the date the calendar meant. `toLocaleDateString` here would
 * hand back the server's opinion, which is the exact bug CLAUDE.md → Dates &
 * Times forbids.
 */
export function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * The time half of a meeting's API shape, and the ONLY place that decides how a
 * meeting's times cross the wire.
 *
 * The two cases are genuinely different things and are returned differently, so
 * a client cannot render one as the other:
 *
 *   - TIMED — `startsAt`/`endsAt` are full ISO-8601 instants (UTC, with the `Z`),
 *     and `timeZone` carries the IANA zone the event was booked in. Together they
 *     are enough to render "Jun 24, 2026, 6:00 PM EDT" with a real zone label.
 *     `startDate`/`endDate` are null: a timed meeting is not a date.
 *   - ALL DAY — `startDate`/`endDate` are bare calendar dates ("2026-08-25"), and
 *     `timeZone` is FORCED to null even if a row carries one. An all-day value
 *     renders with no time and no zone; handing a client a zone would invite it
 *     to shift the date, which is what turns "Aug 25" into "Aug 24, 8:00 PM" for
 *     every viewer west of UTC. The instants are still returned so a list can
 *     sort one calendar in one order.
 *
 * `endDate` is EXCLUSIVE, matching Google: a one-day meeting on the 25th ends on
 * the 26th.
 */
export function mapMeetingTimes(meeting: Pick<Meeting, 'isAllDay' | 'startsAt' | 'endsAt' | 'timeZone'>) {
  return {
    isAllDay: meeting.isAllDay,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    timeZone: meeting.isAllDay ? null : meeting.timeZone,
    startDate: meeting.isAllDay ? calendarDate(meeting.startsAt) : null,
    endDate: meeting.isAllDay ? calendarDate(meeting.endsAt) : null,
  }
}

// --- Mappers: database row → API shape ---------------------------------------

/**
 * One invitee on a meeting.
 *
 * `email` is unconditional and `personId` is nullable — that pair IS the
 * acceptance criterion. An external attendee renders from `email` + `name`; the
 * same row gains a `personId` the day they become a Person, and nothing else
 * about it changes.
 */
export function mapAttendeeToApi(attendee: MeetingAttendee) {
  return {
    id: attendee.id,
    name: attendee.name,
    email: attendee.email,
    personId: attendee.personId,
    responseStatus: attendee.responseStatus,
    isOrganizer: attendee.isOrganizer,
    isOptional: attendee.isOptional,
    isResource: attendee.isResource,
  }
}

/**
 * The list-row shape: enough for a calendar row or an account feed, without the
 * description.
 *
 * The description is the biggest column on the table — a pasted agenda, a wall of
 * boilerplate a scheduling tool appended — and a list never renders it, so a page
 * of 50 would be a payload nobody reads. `location` and `joinUrl` BOTH ride the
 * list row: which of the two a meeting has is what a row shows (a map pin or a
 * video glyph), and deciding that from a detail fetch per row is the N+1 this
 * avoids.
 *
 * `attendeeCount` comes from a `_count` when the caller asked for one, so a row
 * can say "6 attendees" without loading six rows apiece.
 */
export function mapMeetingToListApi(
  meeting: Meeting & { attendees?: MeetingAttendee[]; _count?: { attendees: number } },
) {
  return {
    id: meeting.id,
    title: meeting.title,
    ...mapMeetingTimes(meeting),
    // TWO fields, never merged. See rule 3 in the module header.
    location: meeting.location,
    joinUrl: meeting.joinUrl,
    conferenceProvider: meeting.conferenceProvider,
    status: meeting.status,
    organizerEmail: meeting.organizerEmail,
    organizerPersonId: meeting.organizerPersonId,
    provider: meeting.provider,
    companyId: meeting.companyId,
    dealId: meeting.dealId,
    hasRecording: meeting.recordingUrl !== null,
    createdAt: meeting.createdAt.toISOString(),
    ...(meeting._count ? { attendeeCount: meeting._count.attendees } : {}),
    ...(meeting.attendees ? { attendees: meeting.attendees.map(mapAttendeeToApi) } : {}),
  }
}

/**
 * The single-meeting shape: everything the list carries, plus the description,
 * the recurrence pointer, the calendar deep link, and every attendee.
 *
 * `recordingUrl` is deliberately ABSENT: the column holds a bare S3 object key,
 * not a link a browser can open, exactly as `Call.recordingUrl` does. Handing the
 * key to a client would be handing out an internal path that does nothing.
 * `hasRecording` carries the only part of it a client can act on.
 *
 * `syncCursor` and `providerEventId` are internal sync bookkeeping and are not
 * returned; `webLink` is, because "open in Google Calendar" is a thing a person
 * clicks. `iCalUid` is returned — it is the non-secret cross-provider id an
 * external tool matches on.
 */
export function mapMeetingToDetailApi(meeting: Meeting & { attendees: MeetingAttendee[] }) {
  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    ...mapMeetingTimes(meeting),
    location: meeting.location,
    joinUrl: meeting.joinUrl,
    conferenceProvider: meeting.conferenceProvider,
    status: meeting.status,
    organizerEmail: meeting.organizerEmail,
    organizerPersonId: meeting.organizerPersonId,
    provider: meeting.provider,
    iCalUid: meeting.iCalUid,
    recurringEventId: meeting.recurringEventId,
    webLink: meeting.webLink,
    companyId: meeting.companyId,
    dealId: meeting.dealId,
    hasRecording: meeting.recordingUrl !== null,
    recordingProvider: meeting.recordingProvider,
    transcriptStatus: meeting.transcriptStatus,
    createdAt: meeting.createdAt.toISOString(),
    updatedAt: meeting.updatedAt.toISOString(),
    attendees: meeting.attendees.map(mapAttendeeToApi),
  }
}
