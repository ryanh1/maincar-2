/**
 * Date maths that has to land on a WALL CLOCK in a particular person's timezone.
 *
 * The rule this exists to serve (CLAUDE.md → Dates & Times): a moment that a
 * person understands as "the end of my day" is a wall-clock fact, not a fixed
 * number of hours. Adding `days * 24 * 60 * 60 * 1000` to `Date.now()` lands on
 * an arbitrary time of day, and it lands on the WRONG time of day entirely once
 * the window crosses a DST transition. So every conversion here goes through
 * `Intl.DateTimeFormat` with an explicit `timeZone`, which knows the real offset
 * on the real date. No fixed offset is ever assumed.
 */
import { logger } from '../../dependencies/logger.js'

/**
 * The zone used when a user record carries no `timeZone`.
 *
 * UTC, chosen explicitly. CLAUDE.md forbids letting a fallback land on the
 * SERVER's zone: that value is a property of whichever host the process happens
 * to run on, so the same invite would expire at a different moment after a deploy
 * moved regions, and nothing in the code would say so. UTC is the same everywhere
 * and belongs to nobody, which makes it readable as a deliberate default rather
 * than an accident.
 *
 * What it costs: for a creator in New York with no stored zone, "end of day UTC"
 * is 7:59 PM their time on the expiry date — a few hours short, at the tail of a
 * 14-day window. That is the price of not guessing, and the zone is captured at
 * onboarding, so a null is rare.
 */
export const FALLBACK_TIME_ZONE = 'UTC'

/**
 * The zone to do the maths in. Pass `user.timeZone`.
 *
 * `User.timeZone` is free text on the way in, so an unknown IANA name is a real
 * possibility and would otherwise throw a RangeError out of a route. An
 * unrecognized zone is logged and treated as missing.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    logger.warn({ timeZone }, 'unrecognized IANA timezone on a user record, using UTC')
    return FALLBACK_TIME_ZONE
  }
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** What a clock on the wall in `timeZone` reads at `instant`. */
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/**
 * How far `timeZone` runs ahead of UTC at `instant`, in milliseconds.
 *
 * Read AT an instant, never assumed: the same zone answers differently in July
 * than in January.
 */
function offsetMsAt(instant: Date, timeZone: string): number {
  const w = wallClockIn(instant, timeZone)
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // The wall clock has no milliseconds, so compare against a whole second.
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The UTC instant at which a clock in `timeZone` reads `year-month-day`
 * 23:59:59.999.
 *
 * Two passes, because the offset has to be read at an instant and the instant is
 * what we are solving for. The first pass reads the offset near the answer; the
 * second reads it at a moment that is already on the correct side of any DST
 * transition that day, which is what makes a spring-forward or fall-back date
 * come out right instead of an hour off.
 */
function endOfDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999)
  let instant = wallAsUtc - offsetMsAt(new Date(wallAsUtc), timeZone)
  instant = wallAsUtc - offsetMsAt(new Date(instant), timeZone)
  return new Date(instant)
}

/**
 * `days` CALENDAR days after the day `from` falls on in `timeZone`, at the last
 * millisecond of that day.
 *
 * Calendar days, not 24-hour blocks: an invite created at 9:12 AM and one created
 * at 11:58 PM the same day expire together, at the end of the same date, which is
 * the thing a person means by "expires in 14 days". The real elapsed time is
 * therefore between `days` and `days + 1` days.
 */
export function endOfDayAfterDays(
  from: Date,
  days: number,
  timeZone: string | null | undefined,
): Date {
  const zone = resolveTimeZone(timeZone)
  const today = wallClockIn(from, zone)

  // Date.UTC is used here purely as a calendar — it normalizes day, month and
  // year rollover. No offset is involved, and the result is read straight back
  // out as year/month/day.
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day + days))

  return endOfDayUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    zone,
  )
}
