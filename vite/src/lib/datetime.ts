/**
 * Every time-of-day a person sees goes through here (CLAUDE.md → Dates & Times).
 *
 * The rule these helpers exist to enforce: a time is rendered in the VIEWING
 * user's zone and always carries its zone label, so "6:00 PM" is never ambiguous
 * about which 6:00 PM it means. Never call `toLocaleString` in a component — the
 * browser's zone is not the same thing as the user's zone, and a bare local time
 * is exactly the bug this prevents.
 */

/**
 * The zone to render in. Pass `user.timeZone`.
 *
 * The fallback is the browser's zone rather than the server's: if the stored zone
 * is missing, the machine in front of the reader is the better guess, and it is
 * the same value onboarding would have captured.
 */
function resolveZone(timeZone: string | null | undefined): string {
  return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** `Jun 24, 2026, 6:00 PM EDT` — a moment in time, with its zone named. */
export function formatDateTime(value: string | Date, timeZone: string | null | undefined): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveZone(timeZone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

/**
 * `Jun 24, 2026` — no time, and therefore no zone label.
 *
 * Only for a value that is genuinely a calendar date. A timestamp shortened to
 * its date is still a timestamp, and dropping the zone from one silently shifts
 * it by a day for readers on the other side of midnight.
 *
 * A timestamp that was ANCHORED to a wall clock — an invite expiring at the last
 * millisecond of a day on its inviter's clock — is the one exception, and only
 * when `timeZone` is the zone it was anchored in rather than the viewer's. That
 * pins the same calendar date for every reader, which is the point.
 */
export function formatDate(value: string | Date, timeZone: string | null | undefined): string {
  const isDateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date =
    isDateOnly
      ? new Date(`${value}T12:00:00.000Z`)
      : typeof value === 'string'
        ? new Date(value)
        : value
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-US', {
    timeZone: isDateOnly ? 'UTC' : resolveZone(timeZone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/** The abbreviated zone name for a moment, such as `EDT`. */
export function formatTimeZoneName(value: Date, timeZone: string | null | undefined): string {
  const zone = resolveZone(timeZone)
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(value)
    .find((part) => part.type === 'timeZoneName')?.value ?? zone
}

/** `6:00 PM EDT` — a time-of-day is never shown without its zone label. */
export function formatTime(value: string | Date, timeZone: string | null | undefined): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveZone(timeZone), hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date)
}

function timeZoneOffset(value: Date, timeZone: string): number {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(value)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? '')
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return (match[1] === '+' ? 1 : -1) * minutes * 60_000
}

/** Breaks an ISO timestamp into the viewing user's calendar day and 24-hour time. */
export function zonedDateTimeParts(value: string, timeZone: string | null | undefined): { date: Date | undefined; time: string } {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: undefined, time: '' }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed)
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    date: new Date(valueFor('year'), valueFor('month') - 1, valueFor('day')),
    time: `${String(valueFor('hour')).padStart(2, '0')}:${String(valueFor('minute')).padStart(2, '0')}`,
  }
}

/** Turns a calendar day and time in the viewing user's zone into an ISO timestamp. */
export function zonedDateTimeToIso(date: Date, time: string, timeZone: string | null | undefined): string | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const [hours, minutes] = time.split(':').map(Number)
  if (hours > 23 || minutes > 59) return null
  const zone = resolveZone(timeZone)
  const wallTime = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes)
  let instant = new Date(wallTime - timeZoneOffset(new Date(wallTime), zone))
  instant = new Date(wallTime - timeZoneOffset(instant, zone))
  const roundTrip = zonedDateTimeParts(instant.toISOString(), zone)
  if (
    !roundTrip.date
    || roundTrip.date.getFullYear() !== date.getFullYear()
    || roundTrip.date.getMonth() !== date.getMonth()
    || roundTrip.date.getDate() !== date.getDate()
    || roundTrip.time !== time
  ) return null
  return instant.toISOString()
}
