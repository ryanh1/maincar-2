import { describe, expect, it } from 'vitest'

import {
  callAlertDefaults,
  isDoNotDisturbActive,
  shouldRequestNotificationPermission,
} from './callAlertSettings'

describe('call alert settings', () => {
  it('uses enabled foreground alerts and a disabled do-not-disturb schedule by default', () => {
    expect(callAlertDefaults).toMatchObject({
      incoming: { sound: true, popover: true, browserNotification: false, desktopNotification: false },
      missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
      voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
      doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
    })
  })

  it.each([
    ['2026-08-23T00:00:00.000Z', true],
    ['2026-08-23T12:00:00.000Z', false],
    ['2026-08-23T22:00:00.000Z', true],
  ])('handles an overnight DND schedule at %s', (value, expected) => {
    expect(isDoNotDisturbActive({ enabled: true, startTime: '18:00', endTime: '08:00' }, value, 'America/New_York')).toBe(expected)
  })

  it('does not treat a denied notification permission as requestable', () => {
    expect(shouldRequestNotificationPermission({ browserNotification: true, desktopNotification: true }, 'denied')).toBe(false)
  })

  it('requests permission only when a native notification channel is enabled and permission is undecided', () => {
    expect(shouldRequestNotificationPermission({ browserNotification: false, desktopNotification: false }, 'default')).toBe(false)
    expect(shouldRequestNotificationPermission({ browserNotification: true, desktopNotification: false }, 'default')).toBe(true)
  })
})
