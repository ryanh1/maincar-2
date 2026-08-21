// The wall-clock maths behind invite expiry.
//
// Every assertion here pins an EXACT instant, and most of them also read that
// instant back as a wall clock in the zone it was anchored in. "Roughly 14 days
// from now" would pass against the old `Date.now() + days * 24 * 60 * 60 * 1000`,
// which is the bug these tests exist to keep out: that expression lands on an
// arbitrary time of day, and lands an hour off whenever the window crosses a DST
// transition.
import { describe, expect, it } from 'vitest'

import { FALLBACK_TIME_ZONE, endOfDayAfterDays, resolveTimeZone } from '../datetime.js'

const DAYS = 14

/** The result read back as a clock on the wall in `zone` — `2026-09-04 23:59:59`. */
function wallClock(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const at = (type: string) => parts.find((p) => p.type === type)!.value
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}:${at('second')}`
}

describe('endOfDayAfterDays', () => {
  // 2026-08-21T00:12:00Z is 09:12 on the 21st in Tokyo. Fourteen calendar days
  // later is the 4th, and the last millisecond of the 4th there is 14:59:59.999Z.
  it('anchors to the last millisecond of the day in a zone AHEAD of UTC', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T00:12:00Z'), DAYS, 'Asia/Tokyo')

    expect(result.toISOString()).toBe('2026-09-04T14:59:59.999Z')
    expect(wallClock(result, 'Asia/Tokyo')).toBe('2026-09-04 23:59:59')
  })

  it('anchors to the last millisecond of the day in a zone BEHIND UTC', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T16:12:00Z'), DAYS, 'America/Los_Angeles')

    expect(result.toISOString()).toBe('2026-09-05T06:59:59.999Z')
    expect(wallClock(result, 'America/Los_Angeles')).toBe('2026-09-04 23:59:59')
  })

  // A whole-hour offset would put this at :59:59.999 past the hour. Kolkata is
  // +05:30, so the correct answer is at :29:59.999.
  it('handles a half-hour offset', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T03:42:00Z'), DAYS, 'Asia/Kolkata')

    expect(result.toISOString()).toBe('2026-09-04T18:29:59.999Z')
    expect(wallClock(result, 'Asia/Kolkata')).toBe('2026-09-04 23:59:59')
  })

  // Created on March 1 (EST, UTC-5), expiring on March 15 (EDT, UTC-4) — US DST
  // began on March 8, 2026, inside the window. Carrying the creation-day offset
  // forward, as any fixed-offset arithmetic does, gives 04:59:59.999Z: an hour
  // late, and on the wrong side of local midnight for anyone reading it.
  it('crosses a spring-forward DST transition without drifting an hour', () => {
    const result = endOfDayAfterDays(new Date('2026-03-01T14:12:00Z'), DAYS, 'America/New_York')

    expect(result.toISOString()).toBe('2026-03-16T03:59:59.999Z')
    expect(result.toISOString()).not.toBe('2026-03-16T04:59:59.999Z')
    expect(wallClock(result, 'America/New_York')).toBe('2026-03-15 23:59:59')
  })

  // The mirror image: created on October 25 (EDT, UTC-4), expiring on November 8
  // (EST, UTC-5). US DST ended on November 1, 2026.
  it('crosses a fall-back DST transition without drifting an hour', () => {
    const result = endOfDayAfterDays(new Date('2026-10-25T13:12:00Z'), DAYS, 'America/New_York')

    expect(result.toISOString()).toBe('2026-11-09T04:59:59.999Z')
    expect(result.toISOString()).not.toBe('2026-11-09T03:59:59.999Z')
    expect(wallClock(result, 'America/New_York')).toBe('2026-11-08 23:59:59')
  })

  // "14 days" means fourteen CALENDAR days in the creator's zone, so the time of
  // day it was created at drops out entirely.
  it('gives the same instant for two invites created on the same local day', () => {
    const morning = endOfDayAfterDays(
      new Date('2026-08-21T16:12:00Z'), // 09:12 in Los Angeles
      DAYS,
      'America/Los_Angeles',
    )
    const nearMidnight = endOfDayAfterDays(
      new Date('2026-08-22T06:30:00Z'), // 23:30 the SAME local day in Los Angeles
      DAYS,
      'America/Los_Angeles',
    )

    expect(nearMidnight.toISOString()).toBe(morning.toISOString())
    expect(wallClock(nearMidnight, 'America/Los_Angeles')).toBe('2026-09-04 23:59:59')
  })

  // The day counted from is the creator's day, not UTC's. At 12:00Z on the 21st
  // it is already the 22nd in Kiritimati (+14), so the count starts there.
  it('counts from the calendar day in the creator zone, not the UTC day', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T12:00:00Z'), DAYS, 'Pacific/Kiritimati')

    expect(wallClock(result, 'Pacific/Kiritimati')).toBe('2026-09-05 23:59:59')
    expect(result.toISOString()).toBe('2026-09-05T09:59:59.999Z')
  })

  it('falls back to UTC when the user has no timezone', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T09:12:00Z'), DAYS, null)

    expect(result.toISOString()).toBe('2026-09-04T23:59:59.999Z')
  })

  // `User.timeZone` is free text on the way in, so a junk value must not throw a
  // RangeError out of the route that reads it.
  it('falls back to UTC on a timezone name that does not exist', () => {
    const result = endOfDayAfterDays(new Date('2026-08-21T09:12:00Z'), DAYS, 'Mars/Olympus_Mons')

    expect(result.toISOString()).toBe('2026-09-04T23:59:59.999Z')
  })
})

describe('resolveTimeZone', () => {
  it('keeps a real IANA zone', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York')
  })

  it('answers UTC for null, empty, and unknown zones', () => {
    expect(resolveTimeZone(null)).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone(undefined)).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone('')).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone('Not/AZone')).toBe(FALLBACK_TIME_ZONE)
    expect(FALLBACK_TIME_ZONE).toBe('UTC')
  })
})
