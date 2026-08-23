import { describe, expect, it } from 'vitest'

import { buildCallWebPushPayload, shouldDeliverCallWebPush } from '../callWebPush.js'
import type { CallAlertSettings } from '../../routes/callAlertSettings.js'

const settings: CallAlertSettings = {
  incoming: { sound: true, popover: true, browserNotification: true, desktopNotification: false },
  missed: { sound: false, popover: true, browserNotification: true, desktopNotification: false },
  voicemail: { sound: false, popover: true, browserNotification: true, desktopNotification: false },
  ringSound: 'classic',
  volume: 0.8,
  doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

describe('call web-push delivery', () => {
  it('builds a privacy-safe payload that contains no caller or CRM data', () => {
    const payload = buildCallWebPushPayload({ event: 'incoming', eventKey: 'call:call-1:incoming' })

    expect(payload).toEqual({
      title: 'Incoming call',
      body: 'Open Maincar to view the call.',
      tag: 'call:call-1:incoming',
      url: '/',
    })
  })

  it('suppresses a background alert when the event channel is disabled or DND is active', () => {
    expect(shouldDeliverCallWebPush({
      event: 'missed',
      settings: { ...settings, missed: { ...settings.missed, browserNotification: false } },
      timeZone: 'America/New_York',
      now: '2026-08-23T12:00:00.000Z',
    })).toBe(false)

    expect(shouldDeliverCallWebPush({
      event: 'voicemail',
      settings: { ...settings, doNotDisturb: { enabled: true, startTime: '18:00', endTime: '08:00' } },
      timeZone: 'America/New_York',
      now: '2026-08-23T00:00:00.000Z',
    })).toBe(false)
  })

  it('allows an enabled event outside the user\'s DND schedule', () => {
    expect(shouldDeliverCallWebPush({
      event: 'incoming', settings, timeZone: 'America/New_York', now: '2026-08-23T12:00:00.000Z',
    })).toBe(true)
  })
})
