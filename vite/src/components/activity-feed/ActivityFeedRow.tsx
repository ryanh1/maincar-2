import { useState } from 'react'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { formatRelativeActivityTime, sourceTypeLabel, type ActivityFeedItem } from './activityFeed'

export function ActivityFeedRow({
  item,
  timeZone,
  now,
  selected = false,
  onSelect,
}: {
  item: ActivityFeedItem
  timeZone: string | null | undefined
  now?: Date
  selected?: boolean
  onSelect?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const metadata = [
    item.actorName,
    item.direction ? item.direction[0].toUpperCase() + item.direction.slice(1) : null,
    item.personName,
    item.dealName,
  ].filter((value): value is string => Boolean(value))

  return (
    <article
      data-event-id={item.id}
      aria-current={selected || undefined}
      className={cn('border-b border-border px-3 py-3 last:border-b-0', selected && 'bg-surface-2')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-muted">{sourceTypeLabel(item.sourceType)}</p>
          {onSelect ? (
            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-left text-sm font-medium text-text" onClick={onSelect}>
              {item.title}
            </Button>
          ) : <p className="text-sm font-medium text-text">{item.title}</p>}
        </div>
        <time className="shrink-0 text-xs tabular-nums text-text-muted" dateTime={item.occurredAt} title={formatDateTime(item.occurredAt, timeZone)}>
          {formatRelativeActivityTime(item.occurredAt, now)} · {formatDateTime(item.occurredAt, timeZone)}
        </time>
      </div>

      {item.preview && (
        <div className="mt-1">
          <p className={cn('text-sm text-text-muted', !expanded && 'line-clamp-2')}>{item.preview}</p>
          <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        </div>
      )}

      {metadata.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          {item.actorName && <Avatar name={item.actorName} />}
          <p className="text-xs text-text-muted">{metadata.join(' · ')}</p>
        </div>
      )}
    </article>
  )
}
