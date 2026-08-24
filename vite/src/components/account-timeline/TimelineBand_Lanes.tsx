import { Flag } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import type { AccountTimelineEvent } from '@/lib/accountTimelineTypes'
import { cn } from '@/lib/utils'
import { TimelineBand_EventBubble } from './TimelineBand_EventBubble'
import { timelinePosition } from './timelineBandModel'

export function TimelineBand_Lane({ label, direction, events, bounds, timeZone, highlightedEventId, onSelect, person, now }: {
  label: string
  direction: string
  events: AccountTimelineEvent[]
  bounds: { from: number; to: number }
  timeZone: string | null | undefined
  highlightedEventId?: string | null
  onSelect: (event: AccountTimelineEvent) => void
  person?: boolean
  now: Date
}) {
  return (
    <div className="flex border-b border-border last:border-b-0">
      <div className="flex w-16 shrink-0 items-center overflow-hidden px-2 text-xs font-medium text-muted-foreground" title={label}>
        <span className="truncate" data-person-lane={person || undefined}>{label}</span>
      </div>
      <div className="relative h-16 min-w-0 flex-1 bg-background" aria-label={`${direction} timeline lane`}>
        <TimelineBand_Guides bounds={bounds} now={now} />
        {events.map((event, index) => (
          <TimelineBand_EventBubble
            key={event.id}
            event={event}
            position={timelinePosition(event.occurredAt, bounds.from, bounds.to)}
            selected={event.id === highlightedEventId}
            timeZone={timeZone}
            onSelect={() => onSelect(event)}
            stackIndex={index}
          />
        ))}
      </div>
    </div>
  )
}

export function TimelineBand_Guides({ bounds, now, accessible = false }: {
  bounds: { from: number; to: number }
  now: Date
  accessible?: boolean
}) {
  if (now.getTime() < bounds.from || now.getTime() > bounds.to) return null
  const nowPosition = timelinePosition(now, bounds.from, bounds.to)
  return (
    <>
      <div aria-label={accessible ? 'Future timeline region' : undefined} aria-hidden={accessible ? undefined : true} className="absolute inset-y-0 right-0 bg-accent" style={{ left: `${nowPosition}%` }} />
      <div role={accessible ? 'separator' : undefined} aria-label={accessible ? 'Now' : undefined} aria-orientation={accessible ? 'vertical' : undefined} aria-hidden={accessible ? undefined : true} className="absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `${nowPosition}%` }} />
    </>
  )
}

export function TimelineBand_DealMarker({ event, position, selected, onSelect }: {
  event: AccountTimelineEvent
  position: number
  selected: boolean
  onSelect: () => void
}) {
  const marker = event.marker!
  const label = marker.type === 'deal_created'
    ? 'Deal created'
    : marker.type === 'stage_moved'
      ? `Deal stage moved from ${marker.before} to ${marker.after}`
      : marker.type === 'closed_won'
        ? 'Deal closed won'
        : 'Deal closed lost'
  return (
    <IconButton
      tooltip={label}
      data-deal-marker={marker.type}
      aria-current={selected || undefined}
      className={cn('absolute top-0 z-20 -translate-x-1/2', marker.type === 'closed_won' && 'text-status-success', marker.type === 'closed_lost' && 'text-destructive')}
      style={{ left: `${position}%` }}
      onClick={onSelect}
    >
      <Flag size={16} aria-hidden="true" />
    </IconButton>
  )
}
