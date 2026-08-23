import { resolveTimeZone } from './datetime.js'

export const notificationChannels = ['in_app', 'email', 'push', 'slack'] as const
export type NotificationChannel = (typeof notificationChannels)[number]
export type NotificationTiming = 'immediate' | 'digest' | 'off'
export type DigestFrequency = 'hourly' | 'daily'

export interface ChannelDeliverySettings {
  timing: NotificationTiming
  digestFrequency: DigestFrequency
  digestTime: string
}

export interface NotificationDeliverySettings {
  channels: Record<NotificationChannel, ChannelDeliverySettings>
  quietHours: {
    enabled: boolean
    startTime: string
    endTime: string
  }
}

const defaultChannel = (timing: NotificationTiming): ChannelDeliverySettings => ({
  timing,
  digestFrequency: 'hourly',
  digestTime: '09:00',
})

export const notificationDeliveryDefaults: NotificationDeliverySettings = {
  channels: {
    in_app: defaultChannel('immediate'),
    email: defaultChannel('immediate'),
    push: defaultChannel('immediate'),
    slack: defaultChannel('off'),
  },
  quietHours: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

function minutesAfterMidnight(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function isQuietHoursActive(
  quietHours: NotificationDeliverySettings['quietHours'],
  value: string | Date,
  timeZone: string | null | undefined,
): boolean {
  if (!quietHours.enabled) return false
  const start = minutesAfterMidnight(quietHours.startTime)
  const end = minutesAfterMidnight(quietHours.endTime)
  if (start === null || end === null || start === end) return false

  const at = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(at.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false
  const current = hour * 60 + minute
  return start < end ? current >= start && current < end : current >= start || current < end
}

/** Chooses how a channel worker should handle one notification at this instant. */
export function deliveryModeFor({
  settings,
  channel,
  at = new Date(),
  timeZone,
}: {
  settings: NotificationDeliverySettings
  channel: NotificationChannel
  at?: string | Date
  timeZone: string | null | undefined
}): NotificationTiming {
  if (channel === 'in_app') return 'immediate'
  const timing = settings.channels[channel].timing
  if (timing === 'off' || timing === 'digest') return timing
  return (channel === 'email' || channel === 'push') && isQuietHoursActive(settings.quietHours, at, timeZone)
    ? 'digest'
    : 'immediate'
}
