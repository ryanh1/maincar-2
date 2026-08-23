import type { CallAlertSettings } from '../routes/callAlertSettings.js'

export type CallWebPushEvent = 'incoming' | 'missed' | 'voicemail'

export interface CallWebPushPayload {
  title: string
  body: string
  tag: string
  url: '/'
}

function minutesAfterMidnight(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function isDoNotDisturbActive(settings: CallAlertSettings, now: string | Date, timeZone: string): boolean {
  const { doNotDisturb } = settings
  if (!doNotDisturb.enabled) return false

  const start = minutesAfterMidnight(doNotDisturb.startTime)
  const end = minutesAfterMidnight(doNotDisturb.endTime)
  if (start === null || end === null || start === end) return false

  const value = typeof now === 'string' ? new Date(now) : now
  if (Number.isNaN(value.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false
  const current = hour * 60 + minute
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function shouldDeliverCallWebPush({
  event,
  settings,
  timeZone,
  now = new Date(),
}: {
  event: CallWebPushEvent
  settings: CallAlertSettings
  timeZone: string
  now?: string | Date
}): boolean {
  return settings[event].browserNotification && !isDoNotDisturbActive(settings, now, timeZone)
}

export function buildCallWebPushPayload({ event, eventKey }: { event: CallWebPushEvent; eventKey: string }): CallWebPushPayload {
  const title = event === 'incoming' ? 'Incoming call' : event === 'missed' ? 'Missed call' : 'New voicemail'
  return { title, body: 'Open Maincar to view the call.', tag: eventKey, url: '/' }
}
