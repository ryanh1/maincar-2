export const NOTIFICATION_EVENT_KINDS = ['mention', 'assignment', 'comment', 'status_change', 'team_broadcast'] as const
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'slack'] as const

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number]
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export interface NotificationPreference {
  eventKind: NotificationEventKind
  channel: NotificationChannel
  enabled: boolean
}

const allChannelDefaults = new Set<NotificationEventKind>(['mention', 'assignment'])

export const notificationPreferenceDefaults: NotificationPreference[] = NOTIFICATION_EVENT_KINDS.flatMap((eventKind) =>
  NOTIFICATION_CHANNELS.map((channel) => ({
    eventKind,
    channel,
    enabled: channel === 'in_app' || allChannelDefaults.has(eventKind),
  })),
)
