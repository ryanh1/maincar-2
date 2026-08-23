import { describe, expect, it, vi } from 'vitest'

import { callAlertDefaults } from './callAlertSettings'
import { deliverForegroundCallAlert, playTestRing } from './callAlertDelivery'

describe('foreground call alert delivery', () => {
  it.each(['incoming', 'missed', 'voicemail'] as const)('delivers an in-app popover for %s when enabled', (event) => {
    const popover = vi.fn()
    deliverForegroundCallAlert({
      event,
      title: 'Call alert',
      body: 'A caller needs you.',
      settings: callAlertDefaults,
      timeZone: 'America/New_York',
      now: '2026-08-23T12:00:00.000Z',
      popover,
    })

    expect(popover).toHaveBeenCalledWith('Call alert', { description: 'A caller needs you.' })
  })

  it('suppresses every interruptive delivery channel during DND', () => {
    const sound = vi.fn()
    const popover = vi.fn()
    const nativeNotification = vi.fn()
    deliverForegroundCallAlert({
      event: 'incoming', title: 'Call alert', body: 'A caller needs you.',
      settings: { ...callAlertDefaults, doNotDisturb: { enabled: true, startTime: '18:00', endTime: '08:00' } },
      timeZone: 'America/New_York', now: '2026-08-23T00:00:00.000Z', sound, popover, nativeNotification,
    })

    expect(sound).not.toHaveBeenCalled()
    expect(popover).not.toHaveBeenCalled()
    expect(nativeNotification).not.toHaveBeenCalled()
  })

  it('never emits a native notification after permission was denied', () => {
    const nativeNotification = vi.fn()
    deliverForegroundCallAlert({
      event: 'incoming', title: 'Call alert', body: 'A caller needs you.',
      settings: { ...callAlertDefaults, incoming: { ...callAlertDefaults.incoming, desktopNotification: true } },
      timeZone: 'America/New_York', now: '2026-08-23T12:00:00.000Z', nativePermission: 'denied', nativeNotification,
    })

    expect(nativeNotification).not.toHaveBeenCalled()
  })

  it('cleans up a test ring after its scheduled duration', () => {
    vi.useFakeTimers()
    const stop = vi.fn()
    playTestRing({ volume: 0.4, start: () => stop })

    vi.advanceTimersByTime(3_000)
    expect(stop).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
