export type NotificationView = 'inbox' | 'archived' | 'snoozed'
export type NotificationReadFilter = 'all' | 'unread' | 'read'
export type NotificationEventType = 'all' | 'mentioned' | 'assigned' | 'commented' | 'status_changed'
export type NotificationObjectFilter = 'all' | 'person' | 'company' | 'deal' | 'task' | 'call' | 'note'
export type NotificationAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'unsnooze'

export interface NotificationSource {
  status: 'available' | 'unavailable'
  type: string
  title: string
  preview: string | null
  route?: string
}

export interface NotificationActor {
  name: string
  imageUrl: string | null
}

export interface Notification {
  id: string
  readAt: string | null
  archivedAt: string | null
  snoozedUntil: string | null
  createdAt: string
  actor: NotificationActor | null
  /** The server-written, readable sentence for the whole folded bundle. */
  summary: string
  /** The number of durable events covered by this recipient-owned bundle row. */
  bundleSize: number
  source: NotificationSource
}

export interface GetNotificationsParams {
  view?: NotificationView
  read?: NotificationReadFilter
  type?: NotificationEventType
  objectType?: NotificationObjectFilter
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
