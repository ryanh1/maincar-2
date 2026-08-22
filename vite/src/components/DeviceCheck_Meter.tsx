import { cn } from '@/lib/utils'

/** Bars in the equalizer. Odd, so the middle bar reads as the "center" of the row. */
const BAR_COUNT = 5

/** A lit bar never fully disappears — a sliver stays so the row still reads as bars, not gaps. */
const UNLIT_SCALE = 0.15

export interface MeterProps {
  /** Amplitude, 0…1. Zero renders as an empty (not blank) meter. */
  level: number
  /** Read by a screen reader in place of a percentage bar. */
  label: string
  /** Connects the meter to nearby, non-visual input feedback. */
  describedBy?: string
  className?: string
}

/**
 * A small horizontal-bar amplitude meter, shared by the microphone (continuous)
 * and speaker (single envelope pulse) rows in `DeviceCheck`.
 *
 * Fixed `h-8` to match the `Select`/`Button` it sits beside, with a visible
 * `border-border` + `bg-surface` track so a true zero reading still looks like
 * an idle meter rather than missing UI. Bars animate with `scaleY` only —
 * never a `width`/`height` change — so the motion never touches layout.
 */
export function Meter({ level, label, describedBy, className }: MeterProps) {
  const clamped = Math.max(0, Math.min(1, level))
  const percent = Math.round(clamped * 100)
  const litBars = Math.round(clamped * BAR_COUNT)

  return (
    <div
      role="meter"
      aria-label={label}
      aria-describedby={describedBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent} percent`}
      className={cn(
        'flex h-8 w-24 shrink-0 items-end gap-0.5 rounded-md border border-border bg-surface px-1.5 py-1.5',
        className,
      )}
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        const lit = index < litBars
        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              'h-full w-full origin-bottom rounded-sm transition-transform duration-150 ease-out motion-reduce:transition-none',
              lit ? 'bg-primary' : 'bg-border',
            )}
            style={{ transform: `scaleY(${lit ? 1 : UNLIT_SCALE})` }}
          />
        )
      })}
    </div>
  )
}
