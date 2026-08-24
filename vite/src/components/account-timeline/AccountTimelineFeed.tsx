import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

import { ActivityFeedRow } from '@/components/activity-feed/ActivityFeedRow'
import type { ActivityFeedItem } from '@/components/activity-feed/activityFeed'
import { Button } from '@/components/ui/button'
import { groupFeedItemsByDay } from './feedGroups'

export function AccountTimelineFeed({
  items,
  state,
  timeZone,
  selectedEventId,
  onEventSelect,
  onRetry,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  scrollToEventId,
  scrollRequestKey,
  onVisibleEventChange,
}: {
  items: ActivityFeedItem[]
  state: 'loading' | 'error' | 'empty' | 'ready'
  timeZone: string | null | undefined
  selectedEventId?: string | null
  onEventSelect?: (eventId: string) => void
  onRetry?: () => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  onLoadMore?: () => void
  scrollToEventId?: string | null
  scrollRequestKey?: number
  onVisibleEventChange?: (eventId: string) => void
}) {
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scrollToEventId) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    feedRef.current
      ?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(scrollToEventId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior })
  }, [scrollRequestKey, scrollToEventId])

  if (state === 'loading') {
    return <div className="flex items-center gap-2 p-3 text-sm text-text-muted"><Loader2 className="size-4 animate-spin" /> Loading activity…</div>
  }
  if (state === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-3">
        <p className="text-sm text-danger">Could not load activity.</p>
        {onRetry && <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
      </div>
    )
  }
  if (state === 'empty') return <p className="p-3 text-sm text-text-muted">No activity in this range.</p>

  return (
    <div
      ref={feedRef}
      role="feed"
      aria-label="Account activity"
      aria-keyshortcuts="J K"
      tabIndex={0}
      className="max-h-96 w-full min-w-0 overflow-y-auto border border-border bg-bg"
      onKeyDown={(keyboardEvent) => {
        const target = keyboardEvent.target as HTMLElement
        if (
          keyboardEvent.ctrlKey
          || keyboardEvent.metaKey
          || keyboardEvent.altKey
          || target.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        ) return

        const key = keyboardEvent.key.toLowerCase()
        if (key !== 'j' && key !== 'k') return
        const controls = [...keyboardEvent.currentTarget.querySelectorAll<HTMLButtonElement>('[data-feed-event-control]')]
        if (controls.length === 0) return
        const currentControl = target.closest('[data-event-id]')
          ?.querySelector<HTMLButtonElement>('[data-feed-event-control]')
        const currentIndex = currentControl ? controls.indexOf(currentControl) : -1
        const nextIndex = key === 'j'
          ? Math.min(controls.length - 1, currentIndex + 1)
          : currentIndex < 0 ? controls.length - 1 : Math.max(0, currentIndex - 1)
        keyboardEvent.preventDefault()
        controls[nextIndex]?.focus()
      }}
      onScroll={(scrollEvent) => {
        if (!onVisibleEventChange) return
        const feedTop = scrollEvent.currentTarget.getBoundingClientRect().top
        const closest = [...scrollEvent.currentTarget.querySelectorAll<HTMLElement>('[data-event-id]')]
          .reduce<{ row: HTMLElement | null; distance: number }>((current, row) => {
            const distance = Math.abs(row.getBoundingClientRect().top - feedTop)
            return distance < current.distance ? { row, distance } : current
          }, { row: null, distance: Number.POSITIVE_INFINITY }).row
        if (closest?.dataset.eventId) onVisibleEventChange(closest.dataset.eventId)
      }}
    >
      {groupFeedItemsByDay(items, timeZone).map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="border-b border-border bg-surface px-3 py-2 text-xs font-medium text-text-muted">{group.label}</h3>
          {group.items.map((item) => (
            <ActivityFeedRow key={item.id} item={item} timeZone={timeZone} selected={item.id === selectedEventId} onSelect={onEventSelect ? () => onEventSelect(item.id) : undefined} />
          ))}
        </section>
      ))}
      {hasNextPage && onLoadMore && (
        <div className="border-t border-border p-3">
          <Button type="button" variant="secondary" size="sm" disabled={isFetchingNextPage} onClick={onLoadMore}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
