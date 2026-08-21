import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useGetDevices } from '../useGetDevices'

// jsdom implements no `navigator.mediaDevices`, so every test installs its own.
type Listener = () => void

function deviceInfo(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: `group-${deviceId}`, toJSON: () => ({}) } as MediaDeviceInfo
}

const DEVICES = [
  deviceInfo('audioinput', 'mic-1', 'Headset Microphone'),
  deviceInfo('audiooutput', 'speaker-1', 'Headset Speaker'),
  deviceInfo('videoinput', 'cam-1', 'Webcam'),
]

function installMediaDevices(
  overrides: Partial<Record<'getUserMedia' | 'enumerateDevices', unknown>> = {}
) {
  const stop = vi.fn()
  const listeners = new Map<string, Set<Listener>>()
  const media = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] })),
    enumerateDevices: vi.fn(async () => DEVICES),
    addEventListener: vi.fn((type: string, cb: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(cb)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, cb: Listener) => {
      listeners.get(type)?.delete(cb)
    }),
    ...overrides,
  }
  Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true })
  const emit = async (type: string) => {
    await act(async () => {
      for (const cb of listeners.get(type) ?? []) cb()
    })
  }
  return { media, stop, listeners, emit }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('useGetDevices', () => {
  it('lists microphones and speakers once permission is granted', async () => {
    const { media } = installMediaDevices()

    const { result } = renderHook(() => useGetDevices())
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(result.current.microphones).toEqual([
      { deviceId: 'mic-1', label: 'Headset Microphone', groupId: 'group-mic-1' },
    ])
    expect(result.current.speakers).toEqual([
      { deviceId: 'speaker-1', label: 'Headset Speaker', groupId: 'group-speaker-1' },
    ])
    expect(result.current.error).toBeNull()
  })

  it('stops every track on the permission stream so the mic is not held open', async () => {
    const { stop } = installMediaDevices()

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('returns empty lists and an actionable error when the rep denies the microphone', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const { media } = installMediaDevices({ getUserMedia: vi.fn(async () => Promise.reject(denied)) })

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.microphones).toEqual([])
    expect(result.current.speakers).toEqual([])
    expect(result.current.error).toMatch(/microphone access/i)
    expect(result.current.isLoading).toBe(false)
    expect(media.enumerateDevices).not.toHaveBeenCalled()
  })

  it('re-enumerates when the browser reports a device change', async () => {
    const { media, emit } = installMediaDevices()

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(media.enumerateDevices).toHaveBeenCalledTimes(1)

    media.enumerateDevices.mockResolvedValue([deviceInfo('audioinput', 'mic-2', 'USB Microphone')])
    await emit('devicechange')

    await waitFor(() => expect(result.current.microphones).toHaveLength(1))
    expect(media.enumerateDevices).toHaveBeenCalledTimes(2)
    expect(result.current.microphones[0].deviceId).toBe('mic-2')
    expect(result.current.speakers).toEqual([])
  })

  it('removes the devicechange listener on unmount', async () => {
    const { media, listeners } = installMediaDevices()

    const { result, unmount } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listeners.get('devicechange')?.size).toBe(1)

    unmount()

    expect(media.removeEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function))
    expect(listeners.get('devicechange')?.size).toBe(0)
  })

  it('reports an error instead of crashing when mediaDevices is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.microphones).toEqual([])
    expect(result.current.speakers).toEqual([])
    expect(result.current.error).toMatch(/https/i)
  })

  it('refetch re-reads the devices without prompting again', async () => {
    const { media } = installMediaDevices()

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)

    media.enumerateDevices.mockResolvedValue([deviceInfo('audiooutput', 'speaker-2', 'Desk Speaker')])
    await act(async () => {
      result.current.refetch()
    })

    await waitFor(() => expect(result.current.speakers).toHaveLength(1))
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
    expect(media.enumerateDevices).toHaveBeenCalledTimes(2)
    expect(result.current.microphones).toEqual([])
  })
})
