import type { AccountTimelineEvent, AccountTimelineSourceType } from '@/lib/accountTimelineTypes'
import type { ActivityEntryApi } from '@/lib/crmTypes'

export interface ActivityFeedItem {
  id: string
  sourceType: string
  title: string
  preview: string | null
  actorName: string | null
  personName: string | null
  dealName: string | null
  direction: string | null
  occurredAt: string
}

const SOURCE_TYPE_LABELS: Record<AccountTimelineSourceType, string> = {
  call: 'Call',
  email: 'Email',
  sms: 'Text',
  meeting: 'Meeting',
  note: 'Note',
  stage_change: 'Stage change',
  task: 'Task',
  record_created: 'Record created',
  custom: 'Activity',
}

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType as AccountTimelineSourceType] ?? 'Activity'
}

export function mapAccountTimelineEvent(event: AccountTimelineEvent): ActivityFeedItem {
  return {
    id: event.id,
    sourceType: event.sourceType,
    title: event.title,
    preview: event.preview,
    actorName: event.display.actorName ?? null,
    personName: event.display.personName ?? null,
    dealName: event.display.dealName ?? null,
    direction: event.direction,
    occurredAt: event.occurredAt,
  }
}

/** Maps the compact CRM route's established shape into the shared feed grammar. */
export function mapActivityEntry(entry: ActivityEntryApi): ActivityFeedItem {
  return {
    id: entry.id,
    sourceType: entry.sourceType,
    title: entry.summary,
    preview: entry.preview,
    actorName: null,
    personName: null,
    dealName: null,
    direction: entry.direction,
    occurredAt: entry.occurredAt,
  }
}

export function formatRelativeActivityTime(value: string, now = new Date()): string {
  const occurredAt = new Date(value)
  if (Number.isNaN(occurredAt.getTime())) return ''

  const differenceSeconds = Math.floor((now.getTime() - occurredAt.getTime()) / 1000)
  const isFuture = differenceSeconds < 0
  const elapsedSeconds = Math.abs(differenceSeconds)
  if (elapsedSeconds < 60) return isFuture ? 'In less than a minute' : 'Just now'
  const relative = (count: number, unit: string) => {
    const label = `${count} ${unit}${count === 1 ? '' : 's'}`
    return isFuture ? `in ${label}` : `${label} ago`
  }
  if (elapsedSeconds < 60 * 60) {
    return relative(Math.floor(elapsedSeconds / 60), 'minute')
  }
  if (elapsedSeconds < 24 * 60 * 60) {
    return relative(Math.floor(elapsedSeconds / (60 * 60)), 'hour')
  }
  return relative(Math.floor(elapsedSeconds / (24 * 60 * 60)), 'day')
}
