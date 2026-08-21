/**
 * The compliance check that runs before a number is dialed (MAI-201).
 *
 * Three questions, in this fixed order — do-not-call, then calling hours, then
 * the number's own deliverability status — and only then does a dial happen. The
 * order is the spec's (CRM data-journey impacts, §A2/A9) and it is not arbitrary:
 * the first refusal a caller reads should be the one with the most weight behind
 * it. A number that is BOTH do-not-call and dead is refused for being
 * do-not-call, because that is the reason that carries a penalty.
 *
 * Pure. It takes the resolved target and the instant, and returns a sentence or
 * null. No database, no clock of its own — which is what makes every timezone
 * edge in here testable without waiting for 9 PM somewhere.
 *
 * WHAT IT CANNOT CHECK, and why that is honest rather than a hole: all three
 * facts live on a `PersonPhone` row. A number nobody has ever saved has no row,
 * so it has no do-not-call flag, no status, and no person whose local time we
 * could read. Such a dial is ALLOWED. Refusing every unknown number would mean
 * the keypad could not place a call at all, and pretending to have checked
 * would be worse than saying we could not.
 */
import { formatHourOfDay, formatTimeOfDayWithZone, hourIn, normalizeTimeZone } from './datetime.js'

import type { DialTarget } from './callMatch.js'

/**
 * The calling window, in the CALLEE's local wall clock: 8:00 AM up to but not
 * including 9:00 PM.
 *
 * These are the federal TCPA bounds (47 CFR 64.1200), which is the floor rather
 * than the whole law — several states are narrower, and a state-by-state table
 * is its own piece of work. One window applied everywhere is the conservative
 * simplification, and it is the difference between a guard and no guard at all.
 */
export const CALL_WINDOW_START_HOUR = 8
export const CALL_WINDOW_END_HOUR = 21

/**
 * The stored `reason` behind a dead number, as a person says it. The schema
 * stores tokens; nothing user-facing shows a raw one
 * (rules/design-system.md → "Never show a raw enum value").
 */
const DEAD_REASON_LABELS: Record<string, string> = {
  never_valid: 'never valid',
  no_longer_in_service: 'no longer in service',
  wrong_person: 'wrong person',
}

const PICK_ANOTHER = 'Call a different number for this person.'

/** Why a dial was refused. One sentence of what, one of what to do next. */
export interface DialRefusal {
  /**
   * A machine-readable tag for the refusal, so a caller can branch on the
   * SPECIFIC outcome without matching on prose.
   */
  code: 'dnc' | 'outside_calling_hours' | 'number_dead'
  /** The sentence the dialer shows the rep, verbatim. */
  message: string
}

/**
 * May this number be dialed right now? `null` means yes.
 *
 * `target` is null for a number that matches no saved phone — see the file
 * header for why that is allowed.
 */
export function checkDialAllowed(target: DialTarget | null, now: Date): DialRefusal | null {
  if (!target) return null

  // 1 — Do-not-call. First, and above everything else: it is a legal, permanent,
  // deliberate instruction from the person being called, not a data-quality
  // signal, and no other refusal outranks it.
  if (target.isDnc) {
    const because = target.dncReason ? ` (${target.dncReason})` : ''
    return {
      code: 'dnc',
      message: `This number is on the do-not-call list${because}. ${PICK_ANOTHER}`,
    }
  }

  // 2 — Calling hours, in the CALLEE's zone. Never the server's, never the rep's:
  // a rep in New York dialing Honolulu at 4 PM is calling someone at 10 AM, and a
  // rep in Honolulu dialing New York at 5 PM is calling someone at 10 PM. Only the
  // person on the other end's clock decides.
  //
  // An unrecognized or missing zone SKIPS this check rather than substituting UTC.
  // Judging a stranger's evening by UTC's clock would refuse legitimate calls
  // across most of the Americas and permit late-night ones across Asia — a guard
  // that is wrong in both directions is worse than one that says it does not know.
  const zone = normalizeTimeZone(target.personTimeZone)
  if (zone) {
    const hour = hourIn(now, zone)
    if (hour < CALL_WINDOW_START_HOUR || hour >= CALL_WINDOW_END_HOUR) {
      const localTime = formatTimeOfDayWithZone(now, zone)
      const opens = formatHourOfDay(CALL_WINDOW_START_HOUR)
      const closes = formatHourOfDay(CALL_WINDOW_END_HOUR)
      return {
        code: 'outside_calling_hours',
        message: `It is ${localTime} for this person, outside the ${opens} to ${closes} calling window. Call them after ${opens} their time.`,
      }
    }
  }

  // 3 — The number's own deliverability. Last of the three, because dialing a dead
  // number wastes a minute, where the two above carry a penalty. "unverified" is
  // not a refusal: an unverified number is exactly the one a rep dials to find out.
  if (target.status === 'dead') {
    const label = target.statusReason ? DEAD_REASON_LABELS[target.statusReason] : undefined
    const because = label ? ` (${label})` : ''
    return {
      code: 'number_dead',
      message: `This number is marked dead${because}. ${PICK_ANOTHER}`,
    }
  }

  return null
}
