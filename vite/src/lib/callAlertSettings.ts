export type CallAlertEvent = 'incoming' | 'missed' | 'voicemail'

export interface CallAlertChannels {
  sound: boolean
  popover: boolean
  browserNotification: boolean
  desktopNotification: boolean
}

export interface DoNotDisturbSchedule {
  enabled: boolean
  startTime: string
  endTime: string
}

export interface CallAlertSettings {
  incoming: CallAlertChannels
  missed: CallAlertChannels
  voicemail: CallAlertChannels
  ringSound: 'classic' | 'chime'
  volume: number
  doNotDisturb: DoNotDisturbSchedule
}

const allChannelsDisabled: CallAlertChannels = {
  sound: false,
  popover: false,
  browserNotification: false,
  desktopNotification: false,
}

export const callAlertDefaults: CallAlertSettings = {
  incoming: { ...allChannelsDisabled, sound: true, popover: true },
  missed: { ...allChannelsDisabled, popover: true },
  voicemail: { ...allChannelsDisabled, popover: true },
  ringSound: 'classic',
  volume: 0.8,
  doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

function minutesAfterMidnight(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Whether a moment falls within the user's configured DND wall-clock window. */
export function isDoNotDisturbActive(
  schedule: DoNotDisturbSchedule,
  value: string | Date,
  timeZone: string,
): boolean {
  if (!schedule.enabled) return false
  const start = minutesAfterMidnight(schedule.startTime)
  const end = minutesAfterMidnight(schedule.endTime)
  if (start === null || end === null || start === end) return false

  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false
  const current = hour * 60 + minute

  return start < end ? current >= start && current < end : current >= start || current < end
}

/** Permission is meaningful only for the two native browser/desktop channels. */
export function shouldRequestNotificationPermission(
  channels: Pick<CallAlertChannels, 'browserNotification' | 'desktopNotification'>,
  permission: NotificationPermission,
): boolean {
  return (channels.browserNotification || channels.desktopNotification) && permission === 'default'
}
