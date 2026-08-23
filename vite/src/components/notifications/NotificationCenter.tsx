import { useState } from 'react'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BulkActions, NotificationLoading, NotificationRow } from '@/components/notifications/NotificationCenter_Row'
import { useGetNotifications, useUpdateNotifications } from '@/hooks/notifications'
import { ApiError } from '@/lib/api'
import type {
  NotificationAction,
  NotificationEventType,
  NotificationObjectFilter,
  NotificationReadFilter,
  NotificationView,
} from '@/lib/notificationTypes'
import { useAuth } from '@/providers/useAuth'

const PAGE_SIZE = 25

type NotificationTab = NotificationView | 'unread'

const viewLabels: Record<NotificationTab, string> = {
  inbox: 'Inbox',
  unread: 'Unread',
  archived: 'Archived',
  snoozed: 'Snoozed',
}

const readLabels: Record<NotificationReadFilter, string> = {
  all: 'All notifications',
  unread: 'Unread',
  read: 'Read',
}

const typeLabels: Record<NotificationEventType, string> = {
  all: 'All types',
  mentioned: 'Mention',
  assigned: 'Assignment',
  commented: 'Comment or reply',
  status_changed: 'Status change',
}

const objectLabels: Record<NotificationObjectFilter, string> = {
  all: 'All objects',
  person: 'People',
  company: 'Companies',
  deal: 'Deals',
  task: 'Tasks',
  call: 'Calls',
  note: 'Notes',
}

/** The app-shell bell and recipient-scoped notification drawer. */
export function NotificationCenter({ onOpen }: { onOpen?: () => void }) {
  const { org, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<NotificationTab>('inbox')
  const [read, setRead] = useState<NotificationReadFilter>('all')
  const [type, setType] = useState<NotificationEventType>('all')
  const [objectType, setObjectType] = useState<NotificationObjectFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const unread = useGetNotifications(org?.id, { read: 'unread', limit: 1 })
  const notificationView = view === 'unread' ? 'inbox' : view
  const notificationRead = view === 'unread' ? 'unread' : read
  const inbox = useGetNotifications(org?.id, { view: notificationView, read: notificationRead, type, objectType, limit: PAGE_SIZE })
  const update = useUpdateNotifications()
  const unreadCount = unread.data?.total ?? 0
  const notifications = inbox.data?.notifications ?? []
  const selected = new Set(selectedIds)
  const allSelected = notifications.length > 0 && notifications.every((notification) => selected.has(notification.id))

  const inboxLabel = unreadCount === 0 ? 'Inbox' : `Inbox. ${unreadCount} unread.`

  function changeView(next: NotificationTab): void {
    setView(next)
    setRead(next === 'unread' ? 'unread' : 'all')
    setSelectedIds([])
  }

  function openInbox(): void {
    setOpen(true)
    onOpen?.()
  }

  function toggleSelection(id: string, checked: boolean): void {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))
  }

  function toggleAll(checked: boolean): void {
    setSelectedIds(checked ? notifications.map((notification) => notification.id) : [])
  }

  function runAction(action: NotificationAction, ids: string[], bulk = false): void {
    if (!org || ids.length === 0) return
    const snoozedUntil = action === 'snooze' ? new Date(Date.now() + 86_400_000).toISOString() : undefined
    update.mutate(
      { orgId: org.id, notificationIds: ids, bulk, action, snoozedUntil },
      {
        onSuccess: () => setSelectedIds((current) => current.filter((id) => !ids.includes(id))),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not update notifications. Check your connection and try again.'),
      },
    )
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-label={inboxLabel}
          className="flex h-8 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-white/5"
          onClick={openInbox}
        >
          <Bell size={16} aria-hidden />
          <span>Inbox</span>
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium tabular-nums text-primary-foreground"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby="notification-center-description" className="w-full gap-0 bg-bg p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border p-4 pr-12">
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription id="notification-center-description">Review mentions and updates.</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            <Tabs value={view} onValueChange={(next) => changeView(next as NotificationTab)} className="gap-0">
              <TabsList variant="line" aria-label="Notification views" className="w-full justify-start border-b border-border px-4">
                {(Object.keys(viewLabels) as NotificationTab[]).map((value) => (
                  <TabsTrigger key={value} value={value} className="h-8 flex-none px-3">
                    {viewLabels[value]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
              <Select value={notificationRead} disabled={view === 'unread'} onValueChange={(value) => { setRead(value as NotificationReadFilter); setSelectedIds([]) }}>
                <SelectTrigger size="sm" aria-label="Filter notifications by read state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(readLabels) as NotificationReadFilter[]).map((value) => (
                    <SelectItem key={value} value={value}>{readLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={type} onValueChange={(value) => { setType(value as NotificationEventType); setSelectedIds([]) }}>
                <SelectTrigger size="sm" aria-label="Filter notifications by type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(typeLabels) as NotificationEventType[]).map((value) => <SelectItem key={value} value={value}>{typeLabels[value]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={objectType} onValueChange={(value) => { setObjectType(value as NotificationObjectFilter); setSelectedIds([]) }}>
                <SelectTrigger size="sm" aria-label="Filter notifications by object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(objectLabels) as NotificationObjectFilter[]).map((value) => <SelectItem key={value} value={value}>{objectLabels[value]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="ml-auto text-xs tabular-nums text-text-muted">{inbox.data?.total ?? 0} total</p>
            </div>

            {selectedIds.length > 0 && (
              <BulkActions count={selectedIds.length} view={notificationView} pending={update.isPending} onAction={(action) => runAction(action, selectedIds, true)} />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {inbox.isPending && <NotificationLoading />}
              {inbox.isError && (
                <div role="alert" className="m-4 flex items-center gap-3 rounded-md border border-border p-3">
                  <p className="text-sm text-danger">Could not load notifications.</p>
                  <Button variant="secondary" size="sm" onClick={() => void inbox.refetch()}>Try again</Button>
                </div>
              )}
              {inbox.data && notifications.length === 0 && <EmptyNotifications view={view} />}
              {inbox.data && notifications.length > 0 && (
                <div role="list" aria-label={`${viewLabels[view]} notifications`}>
                  <div className="flex h-8 items-center border-b border-border bg-surface px-4">
                    <Checkbox
                      aria-label="Select all notifications"
                      checked={allSelected}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                    />
                  </div>
                  {notifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      view={notificationView}
                      selected={selected.has(notification.id)}
                      timeZone={user?.timeZone}
                      pending={update.isPending}
                      onSelect={(checked) => toggleSelection(notification.id, checked)}
                      onAction={(action) => runAction(action, [notification.id])}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function EmptyNotifications({ view }: { view: NotificationTab }) {
  const message = view === 'inbox' ? 'No notifications need your attention.' : `No ${viewLabels[view].toLowerCase()} notifications.`
  return <p className="p-6 text-center text-base">{message}</p>
}
