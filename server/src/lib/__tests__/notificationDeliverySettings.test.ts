import { describe, expect, it } from 'vitest'

import { deliveryModeFor } from '../notificationDeliverySettings.js'

const settings = {
  channels: {
    in_app: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    email: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    push: { timing: 'digest', digestFrequency: 'daily', digestTime: '17:00' },
    slack: { timing: 'off', digestFrequency: 'hourly', digestTime: '09:00' },
  },
  quietHours: { enabled: true, startTime: '18:00', endTime: '08:00' },
} as const

describe('deliveryModeFor', () => {
  it('holds email and push during an overnight quiet-hours window but leaves the inbox immediate', () => {
    const at = '2026-08-23T23:00:00.000Z'

    expect(deliveryModeFor({ settings, channel: 'email', at, timeZone: 'America/New_York' })).toBe('digest')
    expect(deliveryModeFor({ settings, channel: 'push', at, timeZone: 'America/New_York' })).toBe('digest')
    expect(deliveryModeFor({ settings, channel: 'in_app', at, timeZone: 'America/New_York' })).toBe('immediate')
  })

  it('honors immediate, digest, and off channel timing outside quiet hours', () => {
    const at = '2026-08-23T14:00:00.000Z'

    expect(deliveryModeFor({ settings, channel: 'email', at, timeZone: 'America/New_York' })).toBe('immediate')
    expect(deliveryModeFor({ settings, channel: 'push', at, timeZone: 'America/New_York' })).toBe('digest')
    expect(deliveryModeFor({ settings, channel: 'slack', at, timeZone: 'America/New_York' })).toBe('off')
  })
})
