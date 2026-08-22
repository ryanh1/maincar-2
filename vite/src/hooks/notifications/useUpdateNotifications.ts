import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type {
  GetNotificationsResponse,
  Notification,
  NotificationAction,
  NotificationActionVariables,
  NotificationReadFilter,
  NotificationView,
} from '@/lib/notificationTypes'

type NotificationQuery = { view?: NotificationView; read?: NotificationReadFilter }

function applyAction(notification: Notification, action: NotificationAction, snoozedUntil?: string): Notification {
  const now = new Date().toISOString()
  switch (action) {
    case 'read': return { ...notification, readAt: now }
    case 'unread': return { ...notification, readAt: null }
    case 'archive': return { ...notification, archivedAt: now }
    case 'unarchive': return { ...notification, archivedAt: null }
    case 'snooze': return { ...notification, snoozedUntil: snoozedUntil ?? notification.snoozedUntil }
    case 'unsnooze': return { ...notification, snoozedUntil: null }
  }
}

function matchesQuery(notification: Notification, query: NotificationQuery): boolean {
  const now = Date.now()
  const isSnoozed = !!notification.snoozedUntil && new Date(notification.snoozedUntil).getTime() > now
  const inView = query.view === 'archived'
    ? !!notification.archivedAt
    : query.view === 'snoozed'
      ? !notification.archivedAt && isSnoozed
      : !notification.archivedAt && !isSnoozed
  if (!inView) return false
  if (query.read === 'read') return !!notification.readAt
  if (query.read === 'unread') return !notification.readAt
  return true
}

/** Applies an action immediately, restores every cached view on failure, then reconciles with the server. */
export function useUpdateNotifications() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, notificationIds, bulk, action, snoozedUntil }: NotificationActionVariables) => {
      const body = { action, ...(snoozedUntil ? { snoozedUntil } : {}) }
      if (!bulk && notificationIds.length === 1) {
        return jsonFetch<{ updated: number }>(`/api/orgs/${orgId}/notifications/${notificationIds[0]}`, {
          method: 'PATCH', body: JSON.stringify(body),
        })
      }
      return jsonFetch<{ updated: number }>(`/api/orgs/${orgId}/notifications/bulk`, {
        method: 'POST', body: JSON.stringify({ ...body, notificationIds }),
      })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all })
      const previous = queryClient.getQueriesData<GetNotificationsResponse>({ queryKey: queryKeys.notifications.all })
      const ids = new Set(variables.notificationIds)
      previous.forEach(([key, data]) => {
        if (!data) return
        const params = (key as QueryKey)[3] as NotificationQuery | undefined
        const changed = data.notifications.map((notification) =>
          ids.has(notification.id) ? applyAction(notification, variables.action, variables.snoozedUntil) : notification,
        )
        const notifications = changed.filter((notification) => matchesQuery(notification, params ?? {}))
        queryClient.setQueryData(key, {
          ...data,
          notifications,
          total: Math.max(0, data.total - (changed.length - notifications.length)),
        })
      })
      return { previous }
    },
    onError: (_error, _variables, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  })
}
