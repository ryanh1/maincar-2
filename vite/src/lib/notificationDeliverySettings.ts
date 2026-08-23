import type { NotificationChannel } from './notificationPreferences'

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
