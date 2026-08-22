// The two formatters every date and time in the UI goes through.
//
// `formatDate` is the one the invite expiry uses: a date, no time, no zone label
// (CLAUDE.md → Dates & Times). The tests below pin the zone-shift behaviour that
// makes passing the ANCHOR zone rather than the viewer's zone matter.
import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, formatTimeZoneName, zonedDateTimeParts, zonedDateTimeToIso } from '../datetime'

// An invite created in New York: the last millisecond of Sep 4 there.
const NY_END_OF_SEP_4 = '2026-09-05T03:59:59.999Z'

describe('formatDate', () => {
  it('renders a date with no time and no zone label', () => {
    expect(formatDate(NY_END_OF_SEP_4, 'America/New_York')).toBe('Sep 4, 2026')
  })

  // The same instant, read in Tokyo, is already the 5th. This is exactly why the
  // invite list passes the INVITER's zone: a viewer far enough east or west would
  // otherwise be shown a different date than the one the inviter set.
  it('shifts the date when read in a zone on the other side of midnight', () => {
    expect(formatDate(NY_END_OF_SEP_4, 'Asia/Tokyo')).toBe('Sep 5, 2026')
    expect(formatDate(NY_END_OF_SEP_4, 'America/Los_Angeles')).toBe('Sep 4, 2026')
  })

  it('accepts a Date as readily as an ISO string', () => {
    expect(formatDate(new Date(NY_END_OF_SEP_4), 'America/New_York')).toBe('Sep 4, 2026')
  })

  it('keeps a date-only value on the same calendar day in a western viewing zone', () => {
    expect(formatDate('2026-08-24', 'America/New_York')).toBe('Aug 24, 2026')
  })

  it('renders nothing for a value that is not a date', () => {
    expect(formatDate('not-a-date', 'America/New_York')).toBe('')
  })
})

describe('formatDateTime', () => {
  it('always names the zone, so a time is never ambiguous', () => {
    expect(formatDateTime('2026-06-24T22:00:00Z', 'America/New_York')).toBe(
      'Jun 24, 2026, 6:00 PM EDT',
    )
  })

  it('renders nothing for a value that is not a date', () => {
    expect(formatDateTime('not-a-date', 'America/New_York')).toBe('')
  })
})

describe('zoned timestamp helpers', () => {
  it('round-trips a viewer-local timestamp with an explicit zone label', () => {
    expect(zonedDateTimeParts('2026-08-25T19:30:00.000Z', 'America/New_York')).toEqual({ date: new Date(2026, 7, 25), time: '15:30' })
    expect(zonedDateTimeToIso(new Date(2026, 7, 25), '15:30', 'America/New_York')).toBe('2026-08-25T19:30:00.000Z')
    expect(formatTimeZoneName(new Date('2026-08-25T19:30:00.000Z'), 'America/New_York')).toBe('EDT')
  })
})
