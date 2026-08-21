import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// DialerProvider now builds a browser Voice SDK Device once an org and a token
// are known. These three are mocked at the module boundary so the state-machine
// tests below run with no org (no Device at all — unchanged from before this
// ticket), while a dedicated describe block further down supplies an org and a
// token to prove the Device wiring itself.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(() => ({ org: null as { id: string } | null })) }))
vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))

const { useGetVoiceTokenMock } = vi.hoisted(() => ({
  useGetVoiceTokenMock: vi.fn(() => ({ data: undefined as unknown, refetch: vi.fn() })),
}))
vi.mock('@/hooks/dialer/useGetVoiceToken', () => ({ useGetVoiceToken: useGetVoiceTokenMock }))

// The server-status poll (MAI-190). Mocked at the module boundary the same way
// useGetVoiceToken is above: DialerProvider is rendered with no QueryClient in
// this file, so the real hook (a real useQuery) would throw.
const { useGetCallDetailMock } = vi.hoisted(() => ({
  useGetCallDetailMock: vi.fn(() => ({ data: undefined as unknown })),
}))
vi.mock('@/hooks/dialer/useGetCallDetail', () => ({ useGetCallDetail: useGetCallDetailMock }))

const { deviceCtorMock, deviceConnectMock, deviceOnMock, deviceUpdateTokenMock, deviceDestroyMock } =
  vi.hoisted(() => ({
    deviceCtorMock: vi.fn(),
    deviceConnectMock: vi.fn(),
    deviceOnMock: vi.fn(),
    deviceUpdateTokenMock: vi.fn(),
    deviceDestroyMock: vi.fn(),
  }))
vi.mock('@/dependencies/twilioVoice', () => ({
  // `function`, not an arrow, so `new Device(token)` works — an arrow function
  // cannot be a constructor.
  Device: vi.fn(function Device(token: string) {
    deviceCtorMock(token)
    return {
      connect: deviceConnectMock,
      on: deviceOnMock,
      updateToken: deviceUpdateTokenMock,
      destroy: deviceDestroyMock,
    }
  }),
}))

import { DialerProvider } from './DialerProvider'
import { useDialer, useDialerOptional } from './dialerContext'

function renderDialer() {
  return renderHook(() => useDialer(), { wrapper: DialerProvider })
}

describe('DialerProvider', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ org: null })
    useGetVoiceTokenMock.mockReturnValue({ data: undefined, refetch: vi.fn() })
    useGetCallDetailMock.mockReturnValue({ data: undefined })
    deviceCtorMock.mockClear()
    deviceConnectMock.mockReset()
    deviceOnMock.mockClear()
    deviceUpdateTokenMock.mockClear()
    deviceDestroyMock.mockClear()
  })

  it('starts collapsed and idle, on the keypad, with a stopped timer', () => {
    const { result } = renderDialer()

    expect(result.current.view).toBe('collapsed')
    expect(result.current.phase).toBe('idle')
    expect(result.current.mode).toBe('keypad')
    expect(result.current.dialing).toBe(false)
    expect(result.current.elapsedSeconds).toBe(0)
  })

  it('expands and collapses the widget', () => {
    const { result } = renderDialer()

    act(() => result.current.expandDialer())
    expect(result.current.view).toBe('expanded')

    act(() => result.current.collapseDialer())
    expect(result.current.view).toBe('collapsed')
  })

  it('toggleView flips between collapsed and expanded', () => {
    const { result } = renderDialer()

    act(() => result.current.toggleView())
    expect(result.current.view).toBe('expanded')

    act(() => result.current.toggleView())
    expect(result.current.view).toBe('collapsed')
  })

  it('stores the placed call, and reset clears it', () => {
    const { result } = renderDialer()
    expect(result.current.activeCall).toBeNull()

    act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: true }))
    expect(result.current.activeCall).toEqual({ orgId: 'org-1', callId: 'call-1', recording: true })

    act(() => result.current.reset())
    expect(result.current.activeCall).toBeNull()
  })

  it('walks a call through ringing, in-progress, and completed', () => {
    const { result } = renderDialer()

    act(() => result.current.startCall())
    // A placed call rings, marks the dialer live, and shows itself.
    expect(result.current.phase).toBe('ringing')
    expect(result.current.dialing).toBe(true)
    expect(result.current.view).toBe('expanded')
    expect(result.current.mode).toBe('call')

    act(() => result.current.connectCall())
    expect(result.current.phase).toBe('in-progress')
    expect(result.current.mode).toBe('call')

    act(() => result.current.endCall())
    // A finished call stops dialing and returns to the keypad, but stays visible.
    expect(result.current.phase).toBe('completed')
    expect(result.current.dialing).toBe(false)
    expect(result.current.mode).toBe('keypad')
  })

  it('reset returns to the idle rest state', () => {
    const { result } = renderDialer()

    act(() => result.current.startCall())
    act(() => result.current.reset())

    expect(result.current.phase).toBe('idle')
    expect(result.current.dialing).toBe(false)
    expect(result.current.elapsedSeconds).toBe(0)
  })

  it('useDialerOptional returns null outside the provider, and the value inside', () => {
    const { result: outside } = renderHook(() => useDialerOptional())
    expect(outside.current).toBeNull()

    const { result: inside } = renderHook(() => useDialerOptional(), { wrapper: DialerProvider })
    expect(inside.current?.phase).toBe('idle')
  })

  it('throws when read outside the provider', () => {
    // React logs the error it catches; silence it so the run stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useDialer())).toThrow(
      'useDialer must be used inside <DialerProvider>.',
    )
    spy.mockRestore()
  })

  describe('the elapsed-seconds timer', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('counts up one second at a time while a call is live', () => {
      const { result } = renderDialer()

      act(() => result.current.startCall())
      expect(result.current.elapsedSeconds).toBe(0)

      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.elapsedSeconds).toBe(3)
    })

    it('does not run before a call is placed', () => {
      const { result } = renderDialer()

      act(() => vi.advanceTimersByTime(5000))
      expect(result.current.elapsedSeconds).toBe(0)
    })

    it('freezes the count when the call ends, then zeroes it on the next call', () => {
      const { result } = renderDialer()

      act(() => result.current.startCall())
      act(() => vi.advanceTimersByTime(2000))
      act(() => result.current.endCall())

      // Frozen at the call's final length — the rep still sees how long it ran.
      expect(result.current.elapsedSeconds).toBe(2)
      act(() => vi.advanceTimersByTime(5000))
      expect(result.current.elapsedSeconds).toBe(2)

      // A new call starts the clock over at 0.
      act(() => result.current.startCall())
      expect(result.current.elapsedSeconds).toBe(0)
      act(() => vi.advanceTimersByTime(1000))
      expect(result.current.elapsedSeconds).toBe(1)
    })

    it('clears the interval when the call ends and when the provider unmounts', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearInterval')
      const { result, unmount } = renderDialer()

      act(() => result.current.startCall())
      act(() => result.current.endCall())
      // Ending the call tears the interval down, so no timer is left ticking.
      expect(clearSpy).toHaveBeenCalledTimes(1)

      act(() => result.current.startCall())
      unmount()
      // Unmounting mid-call tears down the live interval too.
      expect(clearSpy).toHaveBeenCalledTimes(2)

      clearSpy.mockRestore()
    })
  })

  describe('the elapsed-seconds timer counts from answer (MAI-190)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('does not count the ringing period once the callee answers', () => {
      const { result } = renderDialer()

      act(() => result.current.startCall())
      act(() => vi.advanceTimersByTime(4000))
      expect(result.current.elapsedSeconds).toBe(4)

      act(() => result.current.connectCall())
      expect(result.current.elapsedSeconds).toBe(0)

      act(() => vi.advanceTimersByTime(2000))
      expect(result.current.elapsedSeconds).toBe(2)
    })

    it('a second answered report does not restart the timer', () => {
      const { result } = renderDialer()

      act(() => result.current.startCall())
      act(() => result.current.connectCall())
      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.elapsedSeconds).toBe(3)

      // e.g. the Device's own `accept` fires, then the server-status poll also
      // reports `in-progress` a moment later — the second report must not zero
      // a timer that is already counting.
      act(() => result.current.connectCall())
      expect(result.current.elapsedSeconds).toBe(3)
    })
  })

  describe('the server-status poll (MAI-190)', () => {
    function detail(status: string, durationS: number | null = null) {
      return { data: { call: { status, durationS } } }
    }

    it('polls with the live call identity only while dialing', () => {
      const { result } = renderDialer()
      expect(useGetCallDetailMock).toHaveBeenLastCalledWith(undefined, undefined, {
        refetchInterval: expect.any(Number),
      })

      act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: false }))
      expect(useGetCallDetailMock).toHaveBeenLastCalledWith('org-1', 'call-1', {
        refetchInterval: expect.any(Number),
      })

      act(() => result.current.endCall())
      expect(useGetCallDetailMock).toHaveBeenLastCalledWith(undefined, undefined, {
        refetchInterval: expect.any(Number),
      })
    })

    it('moves ringing to in-progress once the server reports in-progress', async () => {
      const { result, rerender } = renderDialer()
      act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: false }))

      useGetCallDetailMock.mockReturnValue(detail('in-progress'))
      rerender()

      await waitFor(() => expect(result.current.phase).toBe('in-progress'))
    })

    it('catches a remote hang-up the dialer never otherwise sees, and shows the billed duration', async () => {
      const { result, rerender } = renderDialer()
      act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: false }))
      act(() => result.current.connectCall())

      useGetCallDetailMock.mockReturnValue(detail('completed', 47))
      rerender()

      await waitFor(() => expect(result.current.phase).toBe('completed'))
      expect(result.current.dialing).toBe(false)
      expect(result.current.elapsedSeconds).toBe(47)
    })

    it('ends a call the callee never answered — busy, failed, no-answer, canceled', async () => {
      const { result, rerender } = renderDialer()
      act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: false }))

      useGetCallDetailMock.mockReturnValue(detail('no-answer'))
      rerender()

      await waitFor(() => expect(result.current.phase).toBe('completed'))
      expect(result.current.dialing).toBe(false)
    })

    it('does not reopen a call the dialer already marked completed', async () => {
      const { result, rerender } = renderDialer()
      act(() => result.current.startCall({ orgId: 'org-1', callId: 'call-1', recording: false }))
      act(() => result.current.endCall(5))
      expect(result.current.elapsedSeconds).toBe(5)

      useGetCallDetailMock.mockReturnValue(detail('completed', 99))
      rerender()

      // Give any (wrongly) queued microtask a turn, then confirm nothing changed.
      await act(() => Promise.resolve())
      expect(result.current.elapsedSeconds).toBe(5)
    })
  })

  describe('the browser Voice SDK Device', () => {
    it('builds no Device while there is no org, and placeDeviceCall refuses', async () => {
      const { result } = renderDialer()

      expect(deviceCtorMock).not.toHaveBeenCalled()
      await expect(result.current.placeDeviceCall({ callId: 'call-1' })).rejects.toThrow(
        'The dialer is still starting up.',
      )
    })

    it('builds the Device from the minted token once an org resolves', () => {
      useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'fake-token', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })

      renderDialer()

      expect(deviceCtorMock).toHaveBeenCalledWith('fake-token')
      expect(deviceCtorMock).toHaveBeenCalledTimes(1)
      // Registers the Device-level seams: a token refresh and a fatal SDK error.
      expect(deviceOnMock).toHaveBeenCalledWith('tokenWillExpire', expect.any(Function))
      expect(deviceOnMock).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('updates the existing Device rather than rebuilding it when the token refreshes', () => {
      useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'token-1', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })
      const { rerender } = renderDialer()
      expect(deviceCtorMock).toHaveBeenCalledTimes(1)

      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'token-2', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })
      rerender()

      expect(deviceCtorMock).toHaveBeenCalledTimes(1)
      expect(deviceUpdateTokenMock).toHaveBeenCalledWith('token-2')
    })

    it('connects the Device with the given params, and wires accept/disconnect onto the dialer phase', async () => {
      useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'fake-token', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })
      // A fake Twilio Call object: records which handler was registered for
      // which event, so the test can fire them the way the real SDK would.
      const callHandlers: Record<string, () => void> = {}
      const fakeCall = { on: vi.fn((event: string, handler: () => void) => (callHandlers[event] = handler)) }
      deviceConnectMock.mockResolvedValue(fakeCall)

      const { result } = renderDialer()
      await act(() => result.current.placeDeviceCall({ callId: 'call-1' }))

      expect(deviceConnectMock).toHaveBeenCalledWith({ params: { callId: 'call-1' } })
      expect(result.current.phase).toBe('idle') // connect() alone does not move the phase

      act(() => callHandlers.accept())
      expect(result.current.phase).toBe('in-progress')

      act(() => callHandlers.disconnect())
      expect(result.current.phase).toBe('completed')
    })

    it('destroys the Device on unmount', () => {
      useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'fake-token', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })
      const { unmount } = renderDialer()

      unmount()

      expect(deviceDestroyMock).toHaveBeenCalledTimes(1)
    })
  })

  // MAI-195: mute and DTMF used to be honest no-ops (the Device did not exist).
  // Now that placeDeviceCall connects one, muteCall/sendDigits must reach the
  // live Call object's own `mute`/`sendDigits` — not just flip UI state.
  describe('mute and DTMF forward to the live Call', () => {
    function connectedCall() {
      const muteMock = vi.fn()
      const sendDigitsMock = vi.fn()
      const fakeCall = { on: vi.fn(), mute: muteMock, sendDigits: sendDigitsMock }
      deviceConnectMock.mockResolvedValue(fakeCall)
      return { muteMock, sendDigitsMock }
    }

    beforeEach(() => {
      useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
      useGetVoiceTokenMock.mockReturnValue({
        data: { token: 'fake-token', identity: 'user-1', ttlSeconds: 3600 },
        refetch: vi.fn(),
      })
    })

    it('muteCall forwards to the live Call once a call is connected', async () => {
      const { muteMock } = connectedCall()
      const { result } = renderDialer()
      await act(() => result.current.placeDeviceCall({ callId: 'call-1' }))

      act(() => result.current.muteCall(true))
      expect(muteMock).toHaveBeenCalledWith(true)

      act(() => result.current.muteCall(false))
      expect(muteMock).toHaveBeenLastCalledWith(false)
    })

    it('sendDigits forwards to the live Call once a call is connected', async () => {
      const { sendDigitsMock } = connectedCall()
      const { result } = renderDialer()
      await act(() => result.current.placeDeviceCall({ callId: 'call-1' }))

      act(() => result.current.sendDigits('5'))
      expect(sendDigitsMock).toHaveBeenCalledWith('5')
    })

    it('muteCall and sendDigits are no-ops with no call connected', () => {
      const { result } = renderDialer()

      expect(() => act(() => result.current.muteCall(true))).not.toThrow()
      expect(() => act(() => result.current.sendDigits('5'))).not.toThrow()
    })

    it('stops forwarding to a call that already ended', async () => {
      const { muteMock } = connectedCall()
      const { result } = renderDialer()
      await act(() => result.current.placeDeviceCall({ callId: 'call-1' }))

      act(() => result.current.endCall())
      act(() => result.current.muteCall(true))

      expect(muteMock).not.toHaveBeenCalled()
    })
  })
})
