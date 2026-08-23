// Unit tests for the Meeting / MeetingAttendee unions, guards, and mappers
// (MAI-139, T11).
//
// These prove the SHAPE a client sees, without an HTTP round-trip: which fields
// cross the wire, which deliberately do not, that `location` and `joinUrl` stay
// TWO fields, that an external attendee maps to something readable with no
// Person behind it, and that an all-day meeting and a timed one leave through
// genuinely different shapes (CLAUDE.md → Dates & Times). The route wiring is
// routes/__tests__/meetings.test.ts; the real constraints are the integration
// suite.
import { describe, expect, it } from 'vitest'

import type { Meeting, MeetingAttendee } from '../../generated/prisma/client.js'
import {
  ATTENDEE_RESPONSE_STATUSES,
  CONFERENCE_PROVIDERS,
  MEETING_PROVIDERS,
  MEETING_STATUSES,
  RECORDING_PROVIDERS,
  TRANSCRIPT_STATUSES,
  calendarDate,
  isAttendeeResponseStatus,
  isConferenceProvider,
  isMeetingProvider,
  isMeetingStatus,
  isRecordingProvider,
  isTranscriptStatus,
  mapAttendeeToApi,
  mapMeetingTimes,
  mapMeetingToDetailApi,
  mapMeetingToListApi,
} from '../meetingActivity.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')

function meetingRow(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-1',
    orgId: 'org-a',
    companyId: null,
    dealId: null,
    manualAttach: false,
    title: 'Discovery call',
    description: 'Agenda: current stack, timeline, budget.',
    location: null,
    joinUrl: null,
    conferenceProvider: null,
    isAllDay: false,
    startsAt: new Date('2026-06-24T22:00:00.000Z'),
    endsAt: new Date('2026-06-24T22:30:00.000Z'),
    timeZone: 'America/New_York',
    status: 'confirmed',
    organizerEmail: 'rep@maincar.com',
    organizerPersonId: null,
    provider: 'google',
    providerEventId: 'evt-abc',
    iCalUid: 'abc@google.com',
    recurringEventId: null,
    syncCursor: '"etag-1"',
    webLink: 'https://calendar.google.com/event?eid=abc',
    recordingUrl: null,
    recordingProvider: null,
    transcriptStatus: null,
    externalRecordingId: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function attendeeRow(overrides: Partial<MeetingAttendee> = {}): MeetingAttendee {
  return {
    id: 'att-1',
    orgId: 'org-a',
    meetingId: 'mtg-1',
    name: 'Dana Külz',
    email: 'dana@external-vendor.example',
    personId: null,
    responseStatus: 'accepted',
    isOrganizer: false,
    isOptional: false,
    isResource: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// --- The unions and their guards ---------------------------------------------

describe('the string unions', () => {
  it('lists exactly the values the schema comments document', () => {
    expect(MEETING_STATUSES).toEqual(['confirmed', 'tentative', 'cancelled'])
    expect(MEETING_PROVIDERS).toEqual(['google', 'm365', 'manual'])
    expect(CONFERENCE_PROVIDERS).toEqual(['google_meet', 'zoom', 'teams', 'other'])
    expect(ATTENDEE_RESPONSE_STATUSES).toEqual([
      'needs_action',
      'accepted',
      'declined',
      'tentative',
    ])
    expect(RECORDING_PROVIDERS).toEqual(['recall_ai', 'gong', 'zoom'])
    expect(TRANSCRIPT_STATUSES).toEqual(['pending', 'done', 'failed'])
  })

  it('narrows a known string and rejects everything else', () => {
    expect(isMeetingStatus('cancelled')).toBe(true)
    expect(isMeetingStatus('CANCELLED')).toBe(false)
    expect(isMeetingStatus(undefined)).toBe(false)

    expect(isMeetingProvider('m365')).toBe(true)
    expect(isMeetingProvider('outlook')).toBe(false)

    expect(isConferenceProvider('google_meet')).toBe(true)
    expect(isConferenceProvider('webex')).toBe(false)

    expect(isAttendeeResponseStatus('needs_action')).toBe(true)
    expect(isAttendeeResponseStatus('maybe')).toBe(false)

    expect(isRecordingProvider('recall_ai')).toBe(true)
    expect(isRecordingProvider('otter')).toBe(false)

    expect(isTranscriptStatus('done')).toBe(true)
    expect(isTranscriptStatus('finished')).toBe(false)
  })
})

// --- Times: the all-day rule --------------------------------------------------

describe('mapMeetingTimes', () => {
  it('gives a TIMED meeting its instants AND its IANA zone', () => {
    // Both halves matter: without the zone a client can only render a bare local
    // time, which CLAUDE.md → Dates & Times forbids outright.
    const times = mapMeetingTimes(meetingRow())
    expect(times.isAllDay).toBe(false)
    expect(times.startsAt).toBe('2026-06-24T22:00:00.000Z')
    expect(times.endsAt).toBe('2026-06-24T22:30:00.000Z')
    expect(times.timeZone).toBe('America/New_York')
    // A timed meeting is an instant, not a date.
    expect(times.startDate).toBeNull()
    expect(times.endDate).toBeNull()
  })

  it('gives an ALL-DAY meeting bare calendar dates and NO zone', () => {
    const times = mapMeetingTimes(
      meetingRow({
        isAllDay: true,
        // Stored as the UTC midnight of the calendar date, per the model comment.
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2026-08-26T00:00:00.000Z'),
        timeZone: 'America/New_York',
      }),
    )
    expect(times.isAllDay).toBe(true)
    expect(times.startDate).toBe('2026-08-25')
    // endDate is EXCLUSIVE, matching Google: a one-day event on the 25th ends on
    // the 26th.
    expect(times.endDate).toBe('2026-08-26')
    // FORCED to null even though the row carries one. An all-day value renders
    // with no time and no zone; handing a client a zone invites it to shift the
    // date, which is how "Aug 25" becomes "Aug 24, 8:00 PM" west of UTC.
    expect(times.timeZone).toBeNull()
  })

  it('still returns the instants on an all-day meeting, so one calendar sorts in one order', () => {
    const times = mapMeetingTimes(
      meetingRow({
        isAllDay: true,
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2026-08-26T00:00:00.000Z'),
      }),
    )
    expect(times.startsAt).toBe('2026-08-25T00:00:00.000Z')
    expect(times.endsAt).toBe('2026-08-26T00:00:00.000Z')
  })

  it('reads calendarDate off the UTC parts, never the process zone', () => {
    // 23:00Z on the 25th is already the 26th in Berlin and still the 25th in
    // Chicago. The stored date is what the calendar meant, so UTC is the only
    // reading that does not depend on where the server happens to run.
    expect(calendarDate(new Date('2026-08-25T23:00:00.000Z'))).toBe('2026-08-25')
    expect(calendarDate(new Date('2026-08-25T00:00:00.000Z'))).toBe('2026-08-25')
  })
})

// --- The attendee shape -------------------------------------------------------

describe('mapAttendeeToApi', () => {
  it('ALWAYS returns the raw email, with a null personId for an external attendee', () => {
    // The acceptance criterion, at the API boundary: an invitee who is not in the
    // CRM still renders, from name + email alone.
    const api = mapAttendeeToApi(attendeeRow())
    expect(api.email).toBe('dana@external-vendor.example')
    expect(api.name).toBe('Dana Külz')
    expect(api.personId).toBeNull()
  })

  it('keeps the SAME email once the attendee is matched to a Person', () => {
    const api = mapAttendeeToApi(attendeeRow({ personId: 'per-1' }))
    expect(api.personId).toBe('per-1')
    // Drawing the link must never replace the address they were invited at.
    expect(api.email).toBe('dana@external-vendor.example')
  })

  it('carries the flags that change what a meeting MEANS', () => {
    const optional = mapAttendeeToApi(attendeeRow({ isOptional: true, responseStatus: 'declined' }))
    expect(optional.isOptional).toBe(true)
    expect(optional.responseStatus).toBe('declined')

    const room = mapAttendeeToApi(
      attendeeRow({ id: 'att-room', email: 'room-4@maincar.com', isResource: true }),
    )
    expect(room.isResource).toBe(true)
  })

  it('never returns orgId or meetingId — the tenant key and the parent the caller already has', () => {
    const api = mapAttendeeToApi(attendeeRow())
    expect(api).not.toHaveProperty('orgId')
    expect(api).not.toHaveProperty('meetingId')
  })
})

// --- The list shape -----------------------------------------------------------

describe('mapMeetingToListApi', () => {
  it('returns location and joinUrl as TWO separate fields', () => {
    // The explicit acceptance criterion. A room with a dial-in has BOTH, and a
    // merged "where" string could not say so.
    const api = mapMeetingToListApi(
      meetingRow({
        location: 'HQ, Room 4',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        conferenceProvider: 'google_meet',
      }),
    )
    expect(api.location).toBe('HQ, Room 4')
    expect(api.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(api.conferenceProvider).toBe('google_meet')
  })

  it('keeps an in-person meeting free of any conference fields', () => {
    const api = mapMeetingToListApi(meetingRow({ location: 'HQ, Room 4' }))
    expect(api.location).toBe('HQ, Room 4')
    expect(api.joinUrl).toBeNull()
    // Null, not "other": an in-person meeting is not a conference with an unknown
    // provider.
    expect(api.conferenceProvider).toBeNull()
  })

  it('keeps a video-only meeting free of a location', () => {
    const api = mapMeetingToListApi(
      meetingRow({ joinUrl: 'https://zoom.us/j/123', conferenceProvider: 'zoom' }),
    )
    expect(api.location).toBeNull()
    expect(api.joinUrl).toBe('https://zoom.us/j/123')
  })

  it('omits the description — the biggest column, and no list renders it', () => {
    const api = mapMeetingToListApi(meetingRow())
    expect(api).not.toHaveProperty('description')
  })

  it('adds attendeeCount only when the caller asked for a _count', () => {
    expect(mapMeetingToListApi(meetingRow())).not.toHaveProperty('attendeeCount')
    const counted = mapMeetingToListApi({ ...meetingRow(), _count: { attendees: 6 } })
    expect(counted.attendeeCount).toBe(6)
  })

  it('reports a recording as a boolean and never as a storage key', () => {
    const api = mapMeetingToListApi(
      meetingRow({ recordingUrl: 'maincar-meeting-recordings/org-a/mtg-1.mp4' }),
    )
    expect(api.hasRecording).toBe(true)
    expect(JSON.stringify(api)).not.toContain('maincar-meeting-recordings')
  })

  it('never returns orgId or the sync cursor', () => {
    const api = mapMeetingToListApi(meetingRow())
    expect(api).not.toHaveProperty('orgId')
    expect(api).not.toHaveProperty('syncCursor')
    expect(api).not.toHaveProperty('providerEventId')
  })
})

// --- The detail shape ---------------------------------------------------------

describe('mapMeetingToDetailApi', () => {
  it('round-trips a TIMED meeting with its zone and both attendees', () => {
    const detail = mapMeetingToDetailApi({
      ...meetingRow({ location: 'HQ, Room 4', joinUrl: 'https://zoom.us/j/1', conferenceProvider: 'zoom' }),
      attendees: [
        attendeeRow({ id: 'att-org', email: 'rep@maincar.com', personId: 'per-rep', isOrganizer: true }),
        attendeeRow(),
      ],
    })
    expect(detail.isAllDay).toBe(false)
    expect(detail.startsAt).toBe('2026-06-24T22:00:00.000Z')
    expect(detail.timeZone).toBe('America/New_York')
    expect(detail.startDate).toBeNull()
    expect(detail.location).toBe('HQ, Room 4')
    expect(detail.joinUrl).toBe('https://zoom.us/j/1')
    expect(detail.attendees).toHaveLength(2)
    expect(detail.attendees.map((a) => a.email)).toEqual([
      'rep@maincar.com',
      'dana@external-vendor.example',
    ])
    // One of them is ours, one of them is a stranger — and BOTH read correctly.
    expect(detail.attendees.map((a) => a.personId)).toEqual(['per-rep', null])
  })

  it('round-trips an ALL-DAY meeting as dates, with no zone anywhere in the payload', () => {
    const detail = mapMeetingToDetailApi({
      ...meetingRow({
        title: 'Onsite at customer HQ',
        isAllDay: true,
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2026-08-26T00:00:00.000Z'),
        timeZone: 'Europe/Berlin',
        location: 'Customer HQ, Berlin',
      }),
      attendees: [],
    })
    expect(detail.isAllDay).toBe(true)
    expect(detail.startDate).toBe('2026-08-25')
    expect(detail.endDate).toBe('2026-08-26')
    expect(detail.timeZone).toBeNull()
    expect(JSON.stringify(detail)).not.toContain('Europe/Berlin')
  })

  it('returns the description and the calendar deep link, but not the sync cursor', () => {
    const detail = mapMeetingToDetailApi({ ...meetingRow(), attendees: [] })
    expect(detail.description).toBe('Agenda: current stack, timeline, budget.')
    expect(detail.webLink).toBe('https://calendar.google.com/event?eid=abc')
    expect(detail.iCalUid).toBe('abc@google.com')
    expect(detail).not.toHaveProperty('syncCursor')
    expect(detail).not.toHaveProperty('providerEventId')
  })

  it('never leaks the recording storage key through the detail shape either', () => {
    const detail = mapMeetingToDetailApi({
      ...meetingRow({
        recordingUrl: 'maincar-meeting-recordings/org-a/mtg-1.mp4',
        recordingProvider: 'recall_ai',
        transcriptStatus: 'done',
      }),
      attendees: [],
    })
    expect(detail.hasRecording).toBe(true)
    expect(detail.recordingProvider).toBe('recall_ai')
    expect(detail.transcriptStatus).toBe('done')
    expect(detail).not.toHaveProperty('recordingUrl')
    expect(JSON.stringify(detail)).not.toContain('maincar-meeting-recordings')
  })

  it('never returns orgId', () => {
    const detail = mapMeetingToDetailApi({ ...meetingRow(), attendees: [attendeeRow()] })
    expect(detail).not.toHaveProperty('orgId')
    expect(JSON.stringify(detail)).not.toContain('org-a')
  })
})
