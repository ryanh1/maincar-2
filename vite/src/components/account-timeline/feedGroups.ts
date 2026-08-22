import type { ActivityFeedItem } from '@/components/activity-feed/activityFeed'
import { formatDate } from '@/lib/datetime'

export interface FeedDayGroup {
  label: string
  items: ActivityFeedItem[]
}

/** Keeps query order while adding viewer-timezone day landmarks. */
export function groupFeedItemsByDay(items: ActivityFeedItem[], timeZone: string | null | undefined): FeedDayGroup[] {
  const groups = new Map<string, ActivityFeedItem[]>()
  for (const item of items) {
    const label = formatDate(item.occurredAt, timeZone)
    const day = groups.get(label)
    if (day) day.push(item)
    else groups.set(label, [item])
  }
  return [...groups].map(([label, dayItems]) => ({ label, items: dayItems }))
}
