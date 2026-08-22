import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useNetworkStatus } from '@/hooks/devices/useNetworkStatus'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

describe('useNetworkStatus', () => {
  afterEach(() => {
    setOnLine(true)
  })

  it('reads the browser online state on mount', () => {
    setOnLine(true)
    const { result } = renderHook(() => useNetworkStatus())

    expect(result.current.online).toBe(true)
  })

  it('flips to offline when the browser fires the offline event', () => {
    setOnLine(true)
    const { result } = renderHook(() => useNetworkStatus())

    setOnLine(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.online).toBe(false)
  })

  it('flips back to online when the browser fires the online event', () => {
    setOnLine(false)
    const { result } = renderHook(() => useNetworkStatus())

    setOnLine(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.online).toBe(true)
  })

  it('stops listening after unmount', () => {
    setOnLine(true)
    const { result, unmount } = renderHook(() => useNetworkStatus())
    unmount()

    setOnLine(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    // The hook already unmounted, so its last read stands.
    expect(result.current.online).toBe(true)
  })
})
