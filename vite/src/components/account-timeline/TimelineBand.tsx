import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { AccountTimelineEvent, AccountTimelineRange } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'
import { TimelineBand_DealMarker, TimelineBand_Guides, TimelineBand_Lane } from './TimelineBand_Lanes'
import {
  makePresetRange,
  panRange,
  personLaneLabel,
  TIMELINE_PRESETS,
  timelineDisplayBounds,
  timelinePosition,
  zoomRange,
} from './timelineBandModel'

export function TimelineBand({
  events,
  range,
  timeZone,
  now = new Date(),
  highlightedEventId,
  onEventSelect,
  onRangeChange,
  onResetRange,
}: {
  events: AccountTimelineEvent[]
  range: AccountTimelineRange
  timeZone: string | null | undefined
  now?: Date
  highlightedEventId?: string | null
  onEventSelect?: (eventId: string) => void
  onRangeChange?: (range: { from: string; to: string }) => void
  onResetRange?: () => void
}) {
  const [showPeople, setShowPeople] = useState(false)
  const bounds = timelineDisplayBounds(range, now)
  const sortedEvents = useMemo(
    () => [...new Map(events.map((event) => [event.id, event])).values()]
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)),
    [events],
  )
  const markerEvents = sortedEvents.filter((event) => event.marker)
  const rangeDurationMs = Date.parse(range.to) - Date.parse(range.from)
  const activePreset = TIMELINE_PRESETS.find((preset) =>
    preset.durationMs !== null && Math.abs(preset.durationMs - rangeDurationMs) < 60_000,
  )?.value

  function selectEvent(event: AccountTimelineEvent) {
    onEventSelect?.(event.id)
    onRangeChange?.(zoomRange(range, new Date(event.occurredAt), 0.5))
  }

  return (
    <section aria-label="Account momentum" className="min-w-0 border border-border bg-background" data-timeline-band>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted p-2">
        <div role="group" aria-label="Timeline duration" className="flex min-w-0 flex-wrap gap-1">
          {TIMELINE_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              variant={preset.value === activePreset ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={preset.value === activePreset}
              onClick={() => onRangeChange?.(makePresetRange(preset.value, now))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <IconButton tooltip="Pan the timeline backward" onClick={() => onRangeChange?.(panRange(range, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </IconButton>
          <IconButton tooltip="Zoom out of the timeline" onClick={() => onRangeChange?.(zoomRange(range, now, 2))}>
            <Minus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton tooltip="Zoom into the timeline" onClick={() => onRangeChange?.(zoomRange(range, now, 0.5))}>
            <Plus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton tooltip="Pan the timeline forward" onClick={() => onRangeChange?.(panRange(range, 1))}>
            <ChevronRight size={16} aria-hidden="true" />
          </IconButton>
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowPeople((value) => !value)}>
            {showPeople ? 'Hide people' : 'Show people'}
          </Button>
          {!range.isDefault && onResetRange && (
            <Button type="button" variant="link" size="sm" onClick={onResetRange}>Reset to default</Button>
          )}
        </div>
      </div>

      <div className="flex border-b border-border">
        <div className="flex w-16 shrink-0 items-center px-2 text-xs font-medium text-muted-foreground">Deal</div>
        <div className="relative h-8 min-w-0 flex-1 bg-muted" aria-label="Deal ribbon">
          {markerEvents.map((event) => (
            <TimelineBand_DealMarker
              key={event.id}
              event={event}
              position={timelinePosition(event.occurredAt, bounds.from, bounds.to)}
              selected={event.id === highlightedEventId}
              onSelect={() => selectEvent(event)}
            />
          ))}
          <TimelineBand_Guides bounds={bounds} now={now} accessible />
        </div>
      </div>

      {showPeople
        ? ['outbound', 'inbound'].flatMap((direction) => {
            const directionEvents = sortedEvents.filter((event) => direction === 'outbound' ? event.direction !== 'inbound' : event.direction === 'inbound')
            const labels = [...new Set(directionEvents.map(personLaneLabel))]
            return labels.map((label) => (
              <TimelineBand_Lane
                key={`${direction}:${label}`}
                label={label}
                direction={direction}
                events={directionEvents.filter((event) => personLaneLabel(event) === label)}
                bounds={bounds}
                timeZone={timeZone}
                highlightedEventId={highlightedEventId}
                onSelect={selectEvent}
                person
                now={now}
              />
            ))
          })
        : (
          <>
            <TimelineBand_Lane label="Outbound" direction="outbound" events={sortedEvents.filter((event) => event.direction !== 'inbound')} bounds={bounds} timeZone={timeZone} highlightedEventId={highlightedEventId} onSelect={selectEvent} now={now} />
            <TimelineBand_Lane label="Inbound" direction="inbound" events={sortedEvents.filter((event) => event.direction === 'inbound')} bounds={bounds} timeZone={timeZone} highlightedEventId={highlightedEventId} onSelect={selectEvent} now={now} />
          </>
        )}

      <div className="flex border-t border-border bg-muted">
        <span className="w-16 shrink-0" aria-hidden="true" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 px-2 py-1 text-xs tabular-nums text-muted-foreground sm:grid-cols-2">
          <time dateTime={range.from} title={formatDateTime(range.from, timeZone)}>{formatDateTime(range.from, timeZone)}</time>
          <time className="sm:text-right" dateTime={range.to} title={formatDateTime(range.to, timeZone)}>{formatDateTime(range.to, timeZone)}</time>
        </div>
      </div>
    </section>
  )
}
