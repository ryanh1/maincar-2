import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEVICE_CHOICE_KEY,
  clearDeviceChoice,
  readDeviceChoice,
  resolveDeviceId,
  saveDeviceChoice,
} from '@/lib/deviceStorage'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readDeviceChoice', () => {
  it('returns nulls when nothing was ever saved', () => {
    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })

  it('returns what was saved', () => {
    saveDeviceChoice({ microphoneId: 'mic-1', speakerId: 'spk-1' })

    expect(readDeviceChoice()).toEqual({ microphoneId: 'mic-1', speakerId: 'spk-1' })
  })

  // Unreadable storage means "use the default", never a thrown error that takes
  // the dialer down with it.
  it('returns nulls when the entry is not JSON', () => {
    window.localStorage.setItem(DEVICE_CHOICE_KEY, 'not json{')

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })

  it('returns nulls when the entry is the wrong shape', () => {
    window.localStorage.setItem(DEVICE_CHOICE_KEY, JSON.stringify(['mic-1']))

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })

  it('returns nulls for a stored literal null', () => {
    window.localStorage.setItem(DEVICE_CHOICE_KEY, 'null')

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })

  it('drops a field an older build wrote as a non-string', () => {
    window.localStorage.setItem(
      DEVICE_CHOICE_KEY,
      JSON.stringify({ microphoneId: 7, speakerId: 'spk-1' }),
    )

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: 'spk-1' })
  })

  // Safari in private mode throws on every storage access.
  it('returns nulls when reading throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })
})

describe('saveDeviceChoice', () => {
  it('leaves the other half of the choice alone', () => {
    saveDeviceChoice({ microphoneId: 'mic-1', speakerId: 'spk-1' })

    saveDeviceChoice({ speakerId: 'spk-2' })

    expect(readDeviceChoice()).toEqual({ microphoneId: 'mic-1', speakerId: 'spk-2' })
  })

  it('reports false instead of throwing when the write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(saveDeviceChoice({ microphoneId: 'mic-1' })).toBe(false)
  })
})

describe('clearDeviceChoice', () => {
  it('forgets both picks', () => {
    saveDeviceChoice({ microphoneId: 'mic-1', speakerId: 'spk-1' })

    clearDeviceChoice()

    expect(readDeviceChoice()).toEqual({ microphoneId: null, speakerId: null })
  })

  it('reports false instead of throwing when the remove fails', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(clearDeviceChoice()).toBe(false)
  })
})

describe('resolveDeviceId', () => {
  const devices = [{ deviceId: 'default' }, { deviceId: 'mic-1' }, { deviceId: 'mic-2' }]

  it('keeps the saved device when it is still plugged in', () => {
    expect(resolveDeviceId('mic-2', devices)).toBe('mic-2')
  })

  // The whole point: never leave a picker pointing at hardware that is gone.
  it('falls back to the system default when the saved device is gone', () => {
    expect(resolveDeviceId('mic-unplugged', devices)).toBe('default')
  })

  it('falls back to the first device when there is no explicit default', () => {
    expect(resolveDeviceId('mic-unplugged', [{ deviceId: 'mic-1' }, { deviceId: 'mic-2' }])).toBe(
      'mic-1',
    )
  })

  it('picks the default when nothing was ever saved', () => {
    expect(resolveDeviceId(null, devices)).toBe('default')
  })

  it('returns null when there are no devices', () => {
    expect(resolveDeviceId('mic-1', [])).toBeNull()
  })

  // The browser returns empty ids before the page holds permission, and Radix's
  // Select throws on an empty value.
  it('ignores devices with an empty id', () => {
    expect(resolveDeviceId(null, [{ deviceId: '' }, { deviceId: 'mic-1' }])).toBe('mic-1')
    expect(resolveDeviceId(null, [{ deviceId: '' }])).toBeNull()
  })
})
