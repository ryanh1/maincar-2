/**
 * Duration formatting.
 *
 * A duration is an elapsed span, not a time of day, so it carries NO timezone and
 * NO zone label — the timezone rules in CLAUDE.md apply to wall-clock times, not
 * to "how long has this call run". Kept out of `datetime.ts` for that reason.
 */

/** Whole seconds as `mm:ss` (e.g. 75 → "01:15"). Clamps negatives to "00:00". */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
