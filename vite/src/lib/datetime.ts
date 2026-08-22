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
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00.000Z`)
      : typeof value === 'string'
        ? new Date(value)
        : value
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveZone(timeZone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
