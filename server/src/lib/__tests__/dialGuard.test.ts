// Unit tests for the dial-time compliance guard (lib/dialGuard.ts, MAI-201).
//
// The guard is pure — a resolved target and an instant in, a sentence or null
// out — so every timezone edge in here is exercised without waiting for 9 PM
// anywhere. The route that enforces it, and the dial signals it gates, are
// proved in routes/__tests__/calls.test.ts.
import { describe, expect, it } from 'vitest'

import {
  CALL_WINDOW_END_HOUR,
  CALL_WINDOW_START_HOUR,
  checkDialAllowed,
} from '../dialGuard.js'

import type { DialTarget } from '../callMatch.js'

/** A reachable, callable number belonging to someone in New York. */
function target(overrides: Partial<DialTarget> = {}): DialTarget {
  return {
    phoneId: 'phone-1',
    isDnc: false,
    dncReason: null,
    status: 'reachable',
    statusReason: null,
    personId: 'person-1',
    companyId: 'company-1',
    personTimeZone: 'America/New_York',
    ...overrides,
  }
}

// 2026-08-21 is a summer date, so New York is on EDT (UTC-4). 16:00 UTC is
// therefore 12:00 PM in New York — the middle of the window.
const MIDDAY_UTC = new Date('2026-08-21T16:00:00.000Z')

describe('checkDialAllowed — do-not-call', () => {
  it('refuses a do-not-call number and says what to do instead', () => {
    const refusal = checkDialAllowed(target({ isDnc: true }), MIDDAY_UTC)

    expect(refusal?.code).toBe('dnc')
    expect(refusal?.message).toBe(
      'This number is on the do-not-call list. Call a different number for this person.',
    )
  })

  it('names the stored reason when there is one', () => {
    const refusal = checkDialAllowed(
      target({ isDnc: true, dncReason: 'asked to be removed' }),
      MIDDAY_UTC,
    )

    expect(refusal?.message).toBe(
      'This number is on the do-not-call list (asked to be removed). Call a different number for this person.',
    )
  })

  it('outranks every other refusal — a do-not-call number that is also dead and out of hours reads as do-not-call', () => {
    // 03:00 UTC is 11 PM the previous evening in New York, and the number is dead.
    // The order in the spec (§A2/A9) is what decides which sentence the rep sees.
    const refusal = checkDialAllowed(
      target({ isDnc: true, status: 'dead', statusReason: 'no_longer_in_service' }),
      new Date('2026-08-21T03:00:00.000Z'),
    )

    expect(refusal?.code).toBe('dnc')
  })
})

describe('checkDialAllowed — calling hours', () => {
  it('allows a call in the middle of the callee’s day', () => {
    expect(checkDialAllowed(target(), MIDDAY_UTC)).toBeNull()
  })

  it('allows a call at the very moment the window opens', () => {
    // 12:00 UTC = 8:00 AM EDT, the first permitted minute.
    expect(checkDialAllowed(target(), new Date('2026-08-21T12:00:00.000Z'))).toBeNull()
  })

  it('allows a call in the window’s last minute', () => {
    // 00:59 UTC on the 22nd = 8:59 PM EDT on the 21st.
    expect(checkDialAllowed(target(), new Date('2026-08-22T00:59:00.000Z'))).toBeNull()
  })

  it('refuses the minute before the window opens', () => {
    // 11:59 UTC = 7:59 AM EDT.
    const refusal = checkDialAllowed(target(), new Date('2026-08-21T11:59:00.000Z'))

    expect(refusal?.code).toBe('outside_calling_hours')
    expect(refusal?.message).toBe(
      'It is 7:59 AM EDT for this person, outside the 8:00 AM to 9:00 PM calling window. Call them after 8:00 AM their time.',
    )
  })

  it('refuses the minute the window closes', () => {
    // 01:00 UTC on the 22nd = 9:00 PM EDT on the 21st — the window END is exclusive.
    const refusal = checkDialAllowed(target(), new Date('2026-08-22T01:00:00.000Z'))

    expect(refusal?.code).toBe('outside_calling_hours')
    expect(refusal?.message).toContain('It is 9:00 PM EDT for this person')
  })

  it('judges by the CALLEE’s zone, not one fixed zone — the same instant is legal in New York and not in Los Angeles', () => {
    // 13:00 UTC is 9:00 AM EDT (fine) and 6:00 AM PDT (too early).
    const instant = new Date('2026-08-21T13:00:00.000Z')

    expect(checkDialAllowed(target({ personTimeZone: 'America/New_York' }), instant)).toBeNull()
    expect(
      checkDialAllowed(target({ personTimeZone: 'America/Los_Angeles' }), instant)?.code,
    ).toBe('outside_calling_hours')
  })

  it('crosses the date line correctly — 22:00 UTC is mid-morning in Auckland, not late evening', () => {
    // 2026-08-21T22:00Z is 2026-08-22 10:00 in Auckland (NZST, UTC+12).
    expect(
      checkDialAllowed(target({ personTimeZone: 'Pacific/Auckland' }), new Date('2026-08-21T22:00:00.000Z')),
    ).toBeNull()
  })

  it('reads the real offset on the real date, so a winter instant is judged on standard time', () => {
    // 2026-01-15T12:30Z is 7:30 AM EST (UTC-5) — too early. The same wall clock
    // reading in August would be 8:30 AM EDT and permitted, which is exactly the
    // hour a fixed offset would get wrong.
    const winter = checkDialAllowed(target(), new Date('2026-01-15T12:30:00.000Z'))

    expect(winter?.code).toBe('outside_calling_hours')
    expect(winter?.message).toContain('7:30 AM EST')

    expect(checkDialAllowed(target(), new Date('2026-08-15T12:30:00.000Z'))).toBeNull()
  })

  it('handles a half-hour offset zone', () => {
    // 02:00 UTC is 7:30 AM in Kolkata (UTC+5:30) — half an hour short of the window.
    const refusal = checkDialAllowed(
      target({ personTimeZone: 'Asia/Kolkata' }),
      new Date('2026-08-21T02:00:00.000Z'),
    )

    expect(refusal?.code).toBe('outside_calling_hours')
    expect(refusal?.message).toContain('7:30 AM')
  })

  it('skips the hours check when nobody has recorded where the person is', () => {
    // 04:00 UTC is midnight in New York — but this person has no stored zone, so
    // there is no clock to judge them by. UTC is NOT substituted.
    expect(
      checkDialAllowed(target({ personTimeZone: null }), new Date('2026-08-21T04:00:00.000Z')),
    ).toBeNull()
  })

  it('skips the hours check when the stored zone is not a real IANA name', () => {
    expect(
      checkDialAllowed(
        target({ personTimeZone: 'Middle/Earth' }),
        new Date('2026-08-21T04:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('uses the exported window bounds in the sentence, so the copy cannot drift from the rule', () => {
    const refusal = checkDialAllowed(target(), new Date('2026-08-21T11:00:00.000Z'))

    expect(CALL_WINDOW_START_HOUR).toBe(8)
    expect(CALL_WINDOW_END_HOUR).toBe(21)
    expect(refusal?.message).toContain('8:00 AM to 9:00 PM')
  })
})

describe('checkDialAllowed — number status', () => {
  it('refuses a dead number and names the reason in words, never the stored token', () => {
    const refusal = checkDialAllowed(
      target({ status: 'dead', statusReason: 'no_longer_in_service' }),
      MIDDAY_UTC,
    )

    expect(refusal?.code).toBe('number_dead')
    expect(refusal?.message).toBe(
      'This number is marked dead (no longer in service). Call a different number for this person.',
    )
    expect(refusal?.message).not.toContain('no_longer_in_service')
  })

  it('refuses a dead number with no stored reason, without an empty bracket', () => {
    const refusal = checkDialAllowed(target({ status: 'dead' }), MIDDAY_UTC)

    expect(refusal?.message).toBe(
      'This number is marked dead. Call a different number for this person.',
    )
  })

  it('leaves an unknown reason token out rather than showing it raw', () => {
    const refusal = checkDialAllowed(
      target({ status: 'dead', statusReason: 'something_new' }),
      MIDDAY_UTC,
    )

    expect(refusal?.message).toBe(
      'This number is marked dead. Call a different number for this person.',
    )
  })

  it('allows an unverified number — that is the one a rep dials to find out', () => {
    expect(checkDialAllowed(target({ status: 'unverified' }), MIDDAY_UTC)).toBeNull()
  })

  it('is checked after calling hours — a dead number reached at midnight reads as out of hours', () => {
    const refusal = checkDialAllowed(
      target({ status: 'dead' }),
      new Date('2026-08-21T04:00:00.000Z'),
    )

    expect(refusal?.code).toBe('outside_calling_hours')
  })
})

describe('checkDialAllowed — an unknown number', () => {
  it('allows a number that matches no saved phone, because there is nothing to check it against', () => {
    expect(checkDialAllowed(null, MIDDAY_UTC)).toBeNull()
    // Even at an hour that would be refused for a known person.
    expect(checkDialAllowed(null, new Date('2026-08-21T04:00:00.000Z'))).toBeNull()
  })
})
