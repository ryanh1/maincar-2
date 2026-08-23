import { OPTION_TOKENS, type OptionToken } from '@/lib/optionPalette'

export interface SpeakerRibbonSegment {
  speakerKey: string
  startMs: number
  endMs: number
}

export interface SpeakerRibbonRange {
  startMs: number
  endMs: number
}

export type SpeakerRibbonMarkerKind = 'search' | 'comment'

export interface SpeakerRibbonMarker {
  id: string
  timeMs: number
  kind: SpeakerRibbonMarkerKind
}

interface PositionedRange extends SpeakerRibbonRange {
  left: number
  width: number
}

export interface SpeakerRibbonLane {
  speakerKey: string
  segments: PositionedRange[]
}

export interface PositionedSpeakerRibbonMarker {
  id: string
  kind: SpeakerRibbonMarkerKind
  left: number
  timeMs: number
}

export interface SpeakerRibbonGeometry {
  durationMs: number
  lanes: SpeakerRibbonLane[]
  bufferedRanges: PositionedRange[]
  playedRanges: PositionedRange[]
  selectionRange: PositionedRange | null
  markers: PositionedSpeakerRibbonMarker[]
  playhead: number
}

export interface BuildSpeakerRibbonGeometryInput {
  durationMs: number
  speakerKeys?: readonly string[]
  segments?: readonly SpeakerRibbonSegment[]
  bufferedRanges?: readonly SpeakerRibbonRange[]
  playedRanges?: readonly SpeakerRibbonRange[]
  selectionRange?: SpeakerRibbonRange | null
  markers?: readonly SpeakerRibbonMarker[]
  currentTimeMs?: number
}

/** Stable by speaker key so the same speaker keeps the same semantic color. */
export function getSpeakerColorToken(speakerKey: string, speakerKeys: readonly string[]): OptionToken {
  const orderedKeys = [...new Set(speakerKeys)].sort()
  const index = Math.max(0, orderedKeys.indexOf(speakerKey))
  return OPTION_TOKENS[index % OPTION_TOKENS.length] ?? OPTION_TOKENS[0]
}

function normalizeDuration(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function positionForTime(timeMs: number, durationMs: number): number {
  if (durationMs === 0 || !Number.isFinite(timeMs)) return 0
  const percentage = clamp((timeMs / durationMs) * 100, 0, 100)
  return Math.round(percentage * 10_000) / 10_000
}

function positionRange(range: SpeakerRibbonRange, durationMs: number): PositionedRange | null {
  if (durationMs === 0 || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) return null
  const startMs = clamp(range.startMs, 0, durationMs)
  const endMs = clamp(range.endMs, 0, durationMs)
  if (endMs <= startMs) return null
  return {
    startMs,
    endMs,
    left: positionForTime(startMs, durationMs),
    width: positionForTime(endMs - startMs, durationMs),
  }
}

function stableSpeakerKeys(
  requestedKeys: readonly string[] | undefined,
  segments: readonly SpeakerRibbonSegment[],
): string[] {
  const segmentKeys = segments.map((segment) => segment.speakerKey).filter(Boolean)
  const remainingKeys = [...new Set(segmentKeys)].filter((key) => !requestedKeys?.includes(key)).sort()
  return [...new Set([...(requestedKeys ?? []), ...remainingKeys])]
}

function emptyGeometry(durationMs: number): SpeakerRibbonGeometry {
  return {
    durationMs,
    lanes: [],
    bufferedRanges: [],
    playedRanges: [],
    selectionRange: null,
    markers: [],
    playhead: 0,
  }
}

/**
 * Converts call-time data into percentages so the ribbon stays responsive and
 * renders a bounded number of DOM nodes even for long calls.
 */
export function buildSpeakerRibbonGeometry({
  durationMs: rawDurationMs,
  speakerKeys,
  segments = [],
  bufferedRanges = [],
  playedRanges = [],
  selectionRange = null,
  markers = [],
  currentTimeMs = 0,
}: BuildSpeakerRibbonGeometryInput): SpeakerRibbonGeometry {
  const durationMs = normalizeDuration(rawDurationMs)
  if (durationMs === 0) return emptyGeometry(durationMs)

  const lanes = stableSpeakerKeys(speakerKeys, segments).map((speakerKey) => ({
    speakerKey,
    segments: segments
      .filter((segment) => segment.speakerKey === speakerKey)
      .map((segment) => positionRange(segment, durationMs))
      .filter((segment): segment is PositionedRange => segment !== null),
  }))

  return {
    durationMs,
    lanes,
    bufferedRanges: bufferedRanges.map((range) => positionRange(range, durationMs)).filter((range): range is PositionedRange => range !== null),
    playedRanges: playedRanges.map((range) => positionRange(range, durationMs)).filter((range): range is PositionedRange => range !== null),
    selectionRange: selectionRange ? positionRange(selectionRange, durationMs) : null,
    markers: markers.map((marker) => ({
      id: marker.id,
      kind: marker.kind,
      left: positionForTime(marker.timeMs, durationMs),
      timeMs: clamp(Number.isFinite(marker.timeMs) ? marker.timeMs : 0, 0, durationMs),
    })),
    playhead: positionForTime(currentTimeMs, durationMs),
  }
}
