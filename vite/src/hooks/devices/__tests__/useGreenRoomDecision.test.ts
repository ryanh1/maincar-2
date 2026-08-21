import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { readGreenRoomCheck, recordGreenRoomCheck } from '@/lib/greenRoomSession'

import { useGreenRoomDecision } from '../useGreenRoomDecision'

// jsdom implements no `navigator.permissions`, so every test installs its own.
type Listener = () => void

function installPermissions(state: PermissionState) {
  const listeners = new Set<Listener>()
  const status = {
    state,
    addEventListener: vi.fn((_type: string, cb: Listener) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: string, cb: Listener) => listeners.delete(cb)),
  }
  const query = vi.fn(async () => status)
  Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })

  const change = async (next: PermissionState) => {
    status.state = next
    await act(async () => {
      for (const cb of listeners) cb()
    })
  }
  return { query, status, listeners, change }
}

/** A greenroom check that passed, as if the rep had just cleared the modal. */
function recordPass(permission: 'granted' | 'prompt' = 'granted') {
  recordGreenRoomCheck({ permission, hasMicrophone: true })
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'permissions')
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('useGreenRoomDecision', () => {
  it('shows the greenroom on the first call of the session', async () => {
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    expect(result.current.reason).toBe('initial')
    expect(result.current.shouldShow).toBe(true)
  })

  it('skips the greenroom on a retry when permission has not changed', async () => {
    recordPass('granted')
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())

    await waitFor(() => expect(result.current.reason).toBe('retry'))
    expect(result.current.shouldShow).toBe(false)
    expect(result.current.permission).toBe('granted')
  })

  it('shows the greenroom when the microphone is denied, even with a recorded pass', async () => {
    recordPass('granted')
    installPermissions('denied')

    const { result } = renderHook(() => useGreenRoomDecision())

    await waitFor(() => expect(result.current.reason).toBe('mic-denied'))
    expect(result.current.shouldShow).toBe(true)
    expect(result.current.permission).toBe('denied')
  })

  it('shows the greenroom when permission differs from the recorded check', async () => {
    recordPass('prompt')
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())

    await waitFor(() => expect(result.current.reason).toBe('permission-changed'))
    expect(result.current.shouldShow).toBe(true)
  })

  it('shows the greenroom again when the rep flips the permission mid-session', async () => {
    recordPass('granted')
    const { change } = installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.reason).toBe('retry'))

    await change('denied')

    expect(result.current.permission).toBe('denied')
    expect(result.current.reason).toBe('mic-denied')
    expect(result.current.shouldShow).toBe(true)
  })

  it('shows the greenroom when the recorded check found no microphone', async () => {
    recordGreenRoomCheck({
      permission: 'granted',
      hasMicrophone: false,
      problem: 'No microphone found. Plug one in, then try again.',
    })
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    expect(result.current.reason).toBe('initial')
    expect(result.current.shouldShow).toBe(true)
  })

  it('recordSession stores the check and skips the greenroom next time', async () => {
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    act(() => {
      result.current.recordSession({ hasMicrophone: true })
    })

    expect(result.current.reason).toBe('retry')
    expect(result.current.shouldShow).toBe(false)
    // It defaults to the permission the hook read, so the record is comparable.
    expect(readGreenRoomCheck()).toMatchObject({ permission: 'granted', hasMicrophone: true })
  })

  it('recordSession captures the problem and keeps showing the greenroom', async () => {
    installPermissions('granted')

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    act(() => {
      result.current.recordSession({
        hasMicrophone: false,
        problem: 'No microphone found. Plug one in, then try again.',
      })
    })

    expect(readGreenRoomCheck()?.problem).toMatch(/plug one in/i)
    expect(result.current.shouldShow).toBe(true)
  })

  it('still shows the greenroom when sessionStorage refuses the write', async () => {
    installPermissions('granted')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })

    const { result } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    expect(() =>
      act(() => {
        result.current.recordSession({ hasMicrophone: true })
      })
    ).not.toThrow()

    // Nothing was recorded, so the next decision fails toward showing.
    expect(result.current.reason).toBe('initial')
    expect(result.current.shouldShow).toBe(true)
  })

  it('does not crash when the browser has no Permissions API', async () => {
    Reflect.deleteProperty(navigator, 'permissions')
    recordPass('granted')

    const { result } = renderHook(() => useGreenRoomDecision())

    await waitFor(() => expect(result.current.reason).toBe('permission-changed'))
    expect(result.current.permission).toBe('unknown')
    expect(result.current.shouldShow).toBe(true)
  })

  it('does not crash when permissions.query rejects the microphone descriptor (Firefox)', async () => {
    const query = vi.fn(async () => {
      throw new TypeError("'microphone' is not a valid enum value")
    })
    Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })
    recordPass('granted')

    const { result } = renderHook(() => useGreenRoomDecision())

    await waitFor(() => expect(query).toHaveBeenCalled())
    expect(result.current.permission).toBe('unknown')
    expect(result.current.shouldShow).toBe(true)
  })

  it('stops listening for permission changes on unmount', async () => {
    const { status, listeners } = installPermissions('granted')

    const { result, unmount } = renderHook(() => useGreenRoomDecision())
    await waitFor(() => expect(result.current.permission).toBe('granted'))
    expect(listeners.size).toBe(1)

    unmount()

    expect(status.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(listeners.size).toBe(0)
  })
})
