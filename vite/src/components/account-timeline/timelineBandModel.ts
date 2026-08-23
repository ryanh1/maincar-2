import type { AccountTimelineEvent, AccountTimelineRange } from '@/lib/accountTimelineTypes'

export type TimelinePreset = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'five-years' | 'all-time'

export const TIMELINE_PRESETS: { value: TimelinePreset; label: string; durationMs: number | null }[] = [
  { value: 'day', label: 'Day', durationMs: 24 * 60 * 60 * 1000 },
  { value: 'week', label: 'Week', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { value: 'month', label: 'Month', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { value: 'quarter', label: 'Quarter', durationMs: 90 * 24 * 60 * 60 * 1000 },
  { value: 'year', label: 'Year', durationMs: 365 * 24 * 60 * 60 * 1000 },
  { value: 'five-years', label: '5Y', durationMs: 5 * 365 * 24 * 60 * 60 * 1000 },
  { value: 'all-time', label: 'All time', durationMs: null },
]

export function makePresetRange(preset: TimelinePreset, now: Date): { from: string; to: string } {
  const durationMs = TIMELINE_PRESETS.find((candidate) => candidate.value === preset)?.durationMs
  if (durationMs === null || durationMs === undefined) {
    const farFuture = new Date(now)
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 5)
    return { from: new Date(0).toISOString(), to: farFuture.toISOString() }
  }

  const futureMs = durationMs / 5
  return {
    from: new Date(now.getTime() - durationMs + futureMs).toISOString(),
    to: new Date(now.getTime() + futureMs).toISOString(),
  }
}

export function panRange(range: AccountTimelineRange, direction: -1 | 1): { from: string; to: string } {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const durationMs = to - from
  return {
    from: new Date(from + durationMs * direction).toISOString(),
    to: new Date(to + durationMs * direction).toISOString(),
  }
}

export function zoomRange(range: AccountTimelineRange, anchor: Date, factor: number): { from: string; to: string } {
  const durationMs = (Date.parse(range.to) - Date.parse(range.from)) * factor
  return {
    from: new Date(anchor.getTime() - durationMs / 2).toISOString(),
    to: new Date(anchor.getTime() + durationMs / 2).toISOString(),
  }
}

export function timelinePosition(value: string | Date, from: number, to: number): number {
  const instant = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (!Number.isFinite(instant) || to <= from) return 0
  return Math.max(0, Math.min(100, ((instant - from) / (to - from)) * 100))
}

export function timelineDisplayBounds(range: AccountTimelineRange, now: Date): { from: number; to: number } {
  const from = Date.parse(range.from)
  const requestedTo = Date.parse(range.to)
  if (now.getTime() < from || now.getTime() > requestedTo) return { from, to: requestedTo }
  const durationMs = requestedTo - from
  const futureTo = now.getTime() + durationMs / 5
  return { from, to: Math.max(requestedTo, futureTo) }
}

export function personLaneLabel(event: AccountTimelineEvent): string {
  if (event.direction === 'inbound') return event.display.personName ?? 'External contact'
  return event.display.actorName ?? 'Account activity'
}
