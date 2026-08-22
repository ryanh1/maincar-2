export type NotificationView = 'inbox' | 'archived' | 'snoozed'
export type NotificationReadFilter = 'all' | 'unread' | 'read'
export type NotificationAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'unsnooze'

export interface NotificationSource {
  status: 'available' | 'unavailable'
  type: string
  title: string
  preview: string | null
  route?: string
}

export interface Notification {
  id: string
  readAt: string | null
  archivedAt: string | null
  snoozedUntil: string | null
  createdAt: string
  source: NotificationSource
}

export interface GetNotificationsParams {
  view?: NotificationView
  read?: NotificationReadFilter
  page?: number
  limit?: number
}

export interface GetNotificationsResponse {
  notifications: Notification[]
  total: number
  page: number
  limit: number
}

export interface NotificationActionVariables {
  orgId: string
  notificationIds: string[]
  /** Use the server's atomic bulk transaction, even for one selected row. */
  bulk?: boolean
  action: NotificationAction
  snoozedUntil?: string
}
