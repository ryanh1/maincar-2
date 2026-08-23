import type { KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AccountTimelineEvent } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { sourceTypeLabel } from '@/components/activity-feed/activityFeed'

const BUBBLE_SIZES: Record<AccountTimelineEvent['intensity'], string> = {
  1: 'size-2',
  2: 'size-3',
  3: 'size-4',
  4: 'size-6',
  5: 'size-8',
}

const BUBBLE_COLORS: Record<AccountTimelineEvent['sourceType'], string> = {
  call: 'bg-(--option-1)',
  email: 'bg-(--option-2)',
  sms: 'bg-(--option-7)',
  meeting: 'bg-(--option-4)',
  note: 'bg-(--option-8)',
  stage_change: 'bg-(--option-6)',
  task: 'bg-(--option-3)',
  record_created: 'bg-(--option-5)',
  custom: 'bg-(--option-8)',
}

export function TimelineBand_EventBubble({
  event,
  position,
  selected,
  timeZone,
  onSelect,
  stackIndex,
}: {
  event: AccountTimelineEvent
  position: number
  selected: boolean
  timeZone: string | null | undefined
  onSelect: () => void
  stackIndex: number
}) {
  const type = sourceTypeLabel(event.sourceType)
  const timestamp = formatDateTime(event.occurredAt, timeZone)
  const accessibleName = `${type}: ${event.title}, ${timestamp}`

  function moveFocus(key: KeyboardEvent<HTMLButtonElement>['key'], current: HTMLButtonElement) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    const bubbles = [...(current.closest('[data-timeline-band]')?.querySelectorAll<HTMLButtonElement>('[data-timeline-bubble]') ?? [])]
      .sort((left, right) => Date.parse(left.dataset.occurredAt ?? '') - Date.parse(right.dataset.occurredAt ?? ''))
    const currentIndex = bubbles.indexOf(current)
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? bubbles.length - 1
        : Math.max(0, Math.min(bubbles.length - 1, currentIndex + (key === 'ArrowLeft' ? -1 : 1)))
    bubbles[nextIndex]?.focus()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-timeline-bubble
          data-occurred-at={event.occurredAt}
          data-intensity={event.intensity}
          data-timeline-position={`${position}%`}
          aria-label={accessibleName}
          aria-current={selected || undefined}
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-transparent p-0',
            stackIndex % 3 === 0 ? 'top-1/4' : stackIndex % 3 === 1 ? 'top-3/4' : 'top-1/2',
            selected && 'border-primary bg-accent ring-2 ring-primary/30',
          )}
          style={{ left: `${position}%` }}
          onClick={onSelect}
          onKeyDown={(keyboardEvent) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyboardEvent.key)) {
              keyboardEvent.preventDefault()
              moveFocus(keyboardEvent.key, keyboardEvent.currentTarget)
            }
          }}
        >
          <span className={cn('rounded-full border border-background', BUBBLE_SIZES[event.intensity], BUBBLE_COLORS[event.sourceType])} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{type} · {event.title} · {timestamp}</TooltipContent>
    </Tooltip>
  )
}
