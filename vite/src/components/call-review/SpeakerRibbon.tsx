import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { formatElapsed } from '@/lib/duration'
import {
  buildSpeakerRibbonGeometry,
  getSpeakerColorToken,
  type SpeakerRibbonMarker,
  type SpeakerRibbonSegment,
} from '@/lib/speakerRibbon'
import { resolveOptionColor } from '@/lib/optionPalette'

export interface SpeakerRibbonSpeaker {
  speakerKey: string
  label: string
}

export interface SpeakerRibbonTimeRange {
  start: number
  end: number
}

export interface SpeakerRibbonSearchTick {
  id: string
  time: number
}

export interface SpeakerRibbonCommentPin {
  id: string
  time: number
}

export interface SpeakerRibbonProps {
  duration: number
  currentTime: number
  segments?: readonly SpeakerRibbonSegment[]
  speakers?: readonly SpeakerRibbonSpeaker[]
  bufferedRanges?: readonly SpeakerRibbonTimeRange[]
  playedRanges?: readonly SpeakerRibbonTimeRange[]
  selectionRange?: SpeakerRibbonTimeRange | null
  searchTicks?: readonly SpeakerRibbonSearchTick[]
  commentPins?: readonly SpeakerRibbonCommentPin[]
  onSeek: (time: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toPercent(event: ReactPointerEvent<HTMLDivElement>): number {
  const bounds = event.currentTarget.getBoundingClientRect()
  if (bounds.width <= 0) return 0
  return clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
}

function rangeStyle(left: number, width: number): CSSProperties {
  return { left: `${left}%`, width: `${width}%` }
}

function seekFromPointer(event: ReactPointerEvent<HTMLDivElement>, duration: number, onSeek: (time: number) => void): void {
  if (duration <= 0) return
  onSeek(toPercent(event) * duration)
}

/** A responsive, keyboard-complete map of speaker activity and review markers. */
export function SpeakerRibbon({
  duration,
  currentTime,
  segments = [],
  speakers = [],
  bufferedRanges = [],
  playedRanges = [],
  selectionRange = null,
  searchTicks = [],
  commentPins = [],
  onSeek,
}: SpeakerRibbonProps) {
  const activePointerId = useRef<number | null>(null)
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const safeCurrentTime = clamp(Number.isFinite(currentTime) ? currentTime : 0, 0, safeDuration)
  const speakerKeys = [...new Set([...speakers.map((speaker) => speaker.speakerKey), ...segments.map((segment) => segment.speakerKey)])]
  const labelByKey = new Map(speakers.map((speaker) => [speaker.speakerKey, speaker.label]))
  const markers: SpeakerRibbonMarker[] = [
    ...searchTicks.map((marker) => ({ id: marker.id, timeMs: marker.time * 1_000, kind: 'search' as const })),
    ...commentPins.map((marker) => ({ id: marker.id, timeMs: marker.time * 1_000, kind: 'comment' as const })),
  ]
  const geometry = buildSpeakerRibbonGeometry({
    durationMs: safeDuration * 1_000,
    speakerKeys,
    segments,
    bufferedRanges: bufferedRanges.map((range) => ({ startMs: range.start * 1_000, endMs: range.end * 1_000 })),
    playedRanges: playedRanges.map((range) => ({ startMs: range.start * 1_000, endMs: range.end * 1_000 })),
    selectionRange: selectionRange ? { startMs: selectionRange.start * 1_000, endMs: selectionRange.end * 1_000 } : null,
    markers,
    currentTimeMs: safeCurrentTime * 1_000,
  })

  function seekByKeyboard(key: string): void {
    if (safeDuration === 0) return
    const step = Math.min(5, safeDuration)
    if (key === 'ArrowLeft') onSeek(clamp(safeCurrentTime - step, 0, safeDuration))
    if (key === 'ArrowRight') onSeek(clamp(safeCurrentTime + step, 0, safeDuration))
    if (key === 'Home') onSeek(0)
    if (key === 'End') onSeek(safeDuration)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (safeDuration === 0) return
    activePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    seekFromPointer(event, safeDuration, onSeek)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== event.pointerId) return
    seekFromPointer(event, safeDuration, onSeek)
  }

  function stopPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerId.current === event.pointerId) activePointerId.current = null
  }

  return (
    <section aria-label="Speaker activity" className="flex flex-col gap-2 border border-border bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-text-muted">Speaker activity</h3>
        <span className="text-xs tabular-nums text-text-muted">{formatElapsed(safeCurrentTime)} / {formatElapsed(safeDuration)}</span>
      </div>
      <div
        role="slider"
        aria-label="Seek call recording"
        aria-valuemin={0}
        aria-valuemax={safeDuration}
        aria-valuenow={safeCurrentTime}
        aria-valuetext={`${formatElapsed(safeCurrentTime)} of ${formatElapsed(safeDuration)}`}
        tabIndex={0}
        className="relative flex min-h-16 flex-col gap-1 border border-border bg-surface p-2 outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          seekByKeyboard(event.key)
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 top-2 h-2 border border-border bg-surface-2">
          {geometry.bufferedRanges.map((range) => <span key={`${range.startMs}-${range.endMs}`} data-testid="speaker-ribbon-buffered-range" className="absolute inset-y-0 bg-surface-2" style={rangeStyle(range.left, range.width)} />)}
          {geometry.playedRanges.map((range) => <span key={`${range.startMs}-${range.endMs}`} data-testid="speaker-ribbon-played-range" className="absolute inset-y-0 bg-primary/40" style={rangeStyle(range.left, range.width)} />)}
          {geometry.selectionRange && <span data-testid="speaker-ribbon-selection-range" className="absolute inset-y-[-1px] border border-primary bg-primary/10" style={rangeStyle(geometry.selectionRange.left, geometry.selectionRange.width)} />}
        </div>
        {geometry.markers.map((marker) => marker.kind === 'search'
          ? <span key={marker.id} data-testid={`speaker-ribbon-marker-${marker.id}`} aria-hidden="true" className="pointer-events-none absolute top-1 h-4 w-px bg-text-muted" style={{ left: `calc(${marker.left}% + 0.5rem)` }} />
          : <span key={marker.id} data-testid={`speaker-ribbon-marker-${marker.id}`} aria-hidden="true" className="pointer-events-none absolute top-0 h-3 w-1 rounded-md bg-accent-brand" style={{ left: `calc(${marker.left}% + 0.5rem)` }} />)}
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `calc(${geometry.playhead}% + 0.5rem)` }} />
        {geometry.lanes.length > 0 ? geometry.lanes.map((lane) => (
          <div key={lane.speakerKey} className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3 pt-3">
            <span className="max-w-28 truncate text-xs font-medium text-text-muted">{labelByKey.get(lane.speakerKey) ?? lane.speakerKey}</span>
            <div className="relative h-4 border border-border bg-bg">
              {lane.segments.map((segment, index) => <span key={`${lane.speakerKey}-${segment.startMs}-${index}`} data-testid="speaker-ribbon-segment" className="absolute inset-y-0 border border-border" style={{ ...rangeStyle(segment.left, segment.width), backgroundColor: resolveOptionColor(getSpeakerColorToken(lane.speakerKey, speakerKeys)) }} />)}
            </div>
          </div>
        )) : <p className="pt-3 text-xs text-text-muted">Call duration is not available.</p>}
      </div>
    </section>
  )
}
