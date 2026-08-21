import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { DialerProvider } from './DialerProvider'
import { useDialer, useDialerOptional } from './dialerContext'

function renderDialer() {
  return renderHook(() => useDialer(), { wrapper: DialerProvider })
}

describe('DialerProvider', () => {
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
})
