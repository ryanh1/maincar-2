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

  // The rep has speakers but no microphone plugged in. That is not a permission
  // failure, so the read must keep going rather than fail the whole screen.
  it('keeps enumerating when there is no microphone to grant, and says so', async () => {
    const missing = Object.assign(new Error('none'), { name: 'NotFoundError' })
    const { media } = installMediaDevices({
      getUserMedia: vi.fn(async () => Promise.reject(missing)),
    })

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(media.enumerateDevices).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('No microphone found. Plug one in, then try again.')
    // Outputs still exist and are still worth showing.
    expect(result.current.speakers).toEqual([
      { deviceId: 'speaker-1', label: 'Headset Speaker', groupId: 'group-speaker-1' },
    ])
  })

  it('treats the older DevicesNotFoundError name the same way', async () => {
    const missing = Object.assign(new Error('none'), { name: 'DevicesNotFoundError' })
    installMediaDevices({ getUserMedia: vi.fn(async () => Promise.reject(missing)) })

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toMatch(/plug one in/i)
    expect(result.current.speakers).toHaveLength(1)
  })

  it('names the next action when the device list itself cannot be read', async () => {
    installMediaDevices({
      enumerateDevices: vi.fn(async () => Promise.reject(new Error('hardware busy'))),
    })

    const { result } = renderHook(() => useGetDevices())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    // The raw Error message never reaches the rep.
    expect(result.current.error).toBe(
      'Could not read your audio devices. Reconnect your headset and try again.'
    )
    expect(result.current.microphones).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  // Unplugging a headset fires devicechange faster than a slow read can finish.
  // The stale answer must lose, or the picker shows hardware that is already gone.
  it('drops a slow read whose result lands after a newer read', async () => {
    const { media } = installMediaDevices()
    let releaseFirst: (devices: MediaDeviceInfo[]) => void = () => {}
    media.enumerateDevices.mockImplementationOnce(
      () => new Promise<MediaDeviceInfo[]>((resolve) => (releaseFirst = resolve))
    )

    const { result } = renderHook(() => useGetDevices())
    // Let the permission prompt settle, leaving the first enumerate in flight.
    await waitFor(() => expect(media.enumerateDevices).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.microphones).toHaveLength(1))
    expect(result.current.microphones[0].deviceId).toBe('mic-1')

    await act(async () => {
      releaseFirst([deviceInfo('audioinput', 'mic-stale', 'Unplugged Microphone')])
    })

    expect(result.current.microphones[0].deviceId).toBe('mic-1')
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
