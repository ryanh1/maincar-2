import { useEffect, useRef, useState } from 'react'

import { mapAccountTimelineEvent } from '@/components/activity-feed/activityFeed'
import type { AccountTimelineEvent, AccountTimelineRange } from '@/lib/accountTimelineTypes'
import { AccountTimelineFeed } from './AccountTimelineFeed'
import { TimelineBand } from './TimelineBand'

export function AccountTimelineWorkspace({
  events,
  state,
  range,
  timeZone,
  now,
  selectedEventId,
  highlightedEventId,
  onEventSelect,
  onHighlightedEventChange,
  onRangeChange,
  onResetRange,
  onRetry,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
}: {
  events: AccountTimelineEvent[]
  state: 'loading' | 'error' | 'empty' | 'ready'
  range: AccountTimelineRange | null
  timeZone: string | null | undefined
  now?: Date
  selectedEventId: string | null
  highlightedEventId: string | null
  onEventSelect: (eventId: string) => void
  onHighlightedEventChange: (eventId: string) => void
  onRangeChange?: (range: { from: string; to: string }) => void
  onResetRange?: () => void
  onRetry?: () => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  onLoadMore?: () => void
}) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const selectionSourceRef = useRef<HTMLElement | null>(null)
  const previousSelectedEventIdRef = useRef(selectedEventId)
  const [scrollRequest, setScrollRequest] = useState<{ eventId: string; key: number } | null>(null)

  useEffect(() => {
    if (previousSelectedEventIdRef.current !== null && selectedEventId === null) {
      const selectionSource = selectionSourceRef.current
      selectionSourceRef.current = null
      selectionSource?.focus()
    }
    previousSelectedEventIdRef.current = selectedEventId
  }, [selectedEventId])

  function rememberSelectionSource() {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && workspaceRef.current?.contains(activeElement)) {
      selectionSourceRef.current = activeElement
    }
  }

  function selectFromBand(eventId: string) {
    rememberSelectionSource()
    onHighlightedEventChange(eventId)
    setScrollRequest((current) => ({ eventId, key: (current?.key ?? 0) + 1 }))
    onEventSelect(eventId)
  }

  function selectFromFeed(eventId: string) {
    rememberSelectionSource()
    onHighlightedEventChange(eventId)
    onEventSelect(eventId)
  }

  return (
    <div ref={workspaceRef} className="flex min-w-0 flex-col gap-6">
      {range && (
        <TimelineBand
          events={events}
          range={range}
          timeZone={timeZone}
          now={now}
          highlightedEventId={highlightedEventId}
          onEventSelect={selectFromBand}
          onRangeChange={onRangeChange}
          onResetRange={onResetRange}
        />
      )}
      <AccountTimelineFeed
        items={events.map(mapAccountTimelineEvent)}
        state={state}
        timeZone={timeZone}
        selectedEventId={selectedEventId}
        onEventSelect={selectFromFeed}
        onRetry={onRetry}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
        scrollToEventId={scrollRequest?.eventId}
        scrollRequestKey={scrollRequest?.key}
        onVisibleEventChange={onHighlightedEventChange}
      />
    </div>
  )
}
