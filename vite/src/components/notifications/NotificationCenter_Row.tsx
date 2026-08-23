import { MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/datetime'
import type { Notification, NotificationAction, NotificationView } from '@/lib/notificationTypes'

export function NotificationRow({
  notification,
  view,
  selected,
  timeZone,
  pending,
  onSelect,
  onAction,
}: {
  notification: Notification
  view: NotificationView
  selected: boolean
  timeZone: string | null | undefined
  pending: boolean
  onSelect: (checked: boolean) => void
  onAction: (action: NotificationAction) => void
}) {
  const sourcePath = sourcePathFor(notification)
  const title = sourcePath ? <Link to={sourcePath} className="font-medium text-primary underline-offset-4 hover:underline">{notification.source.title}</Link> : notification.source.title

  return (
    <article role="listitem" className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
      <Checkbox
        aria-label={`Select ${notification.source.title}`}
        checked={selected}
        className="mt-1"
        onCheckedChange={(checked) => onSelect(checked === true)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm">{title}</p>
          {!notification.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </div>
        {notification.source.preview && <p className="mt-1 line-clamp-2 text-sm text-text-muted">{notification.source.preview}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="tabular-nums">{formatDateTime(notification.createdAt, timeZone)}</span>
          {notification.snoozedUntil && <span>Snoozed until {formatDateTime(notification.snoozedUntil, timeZone)}</span>}
          {notification.source.status === 'unavailable' && <span>Source unavailable</span>}
        </div>
      </div>
      <RowActions notification={notification} view={view} pending={pending} onAction={onAction} />
    </article>
  )
}

export function BulkActions({ count, view, pending, onAction }: { count: number; view: NotificationView; pending: boolean; onAction: (action: NotificationAction) => void }) {
  const actions = view === 'archived'
    ? [['Unarchive', 'unarchive']] as const
    : view === 'snoozed'
      ? [['Unsnooze', 'unsnooze']] as const
      : [['Mark as read', 'read'], ['Mark as unread', 'unread'], ['Archive', 'archive'], ['Snooze for one day', 'snooze']] as const

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2" role="status">
      <p className="text-sm tabular-nums">{count} selected</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" disabled={pending}>Bulk actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map(([label, action]) => <DropdownMenuItem key={action} onSelect={() => onAction(action)}>{label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function NotificationLoading() {
  return (
    <div aria-label="Loading notifications" className="flex flex-col gap-2 p-4">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

function RowActions({ notification, view, pending, onAction }: { notification: Notification; view: NotificationView; pending: boolean; onAction: (action: NotificationAction) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton tooltip={`Show actions for ${notification.source.title}`} disabled={pending}>
          <MoreHorizontal size={16} aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {view === 'archived' ? (
          <DropdownMenuItem onSelect={() => onAction('unarchive')}>Unarchive</DropdownMenuItem>
        ) : view === 'snoozed' ? (
          <DropdownMenuItem onSelect={() => onAction('unsnooze')}>Unsnooze</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onAction(notification.readAt ? 'unread' : 'read')}>
              Mark as {notification.readAt ? 'unread' : 'read'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('archive')}>Archive</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('snooze')}>Snooze for one day</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function sourcePathFor(notification: Notification): string | null {
  if (notification.source.status !== 'available' || !notification.source.route) return null
  const call = notification.source.route.match(/\/calls\/([^/]+)$/)
  if (notification.source.type === 'call') return call ? `/calls/${call[1]}` : null

  const note = notification.source.route.match(/\/records\/([^/?]+)(\?.*)?$/)
  if (notification.source.type === 'note') return note ? `/records/${note[1]}${note[2] ?? ''}` : null
  return null
}
