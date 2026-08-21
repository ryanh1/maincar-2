import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  DialerContext,
  type CallPhase,
  type DialerContextValue,
  type DialerMode,
  type DialerView,
} from './dialerContext'

/**
 * The dialer's shared state, mounted once high in the tree so a call survives
 * navigation the way the composer's cards do. It holds the widget's size, where
 * the current call is in its life, and the running call timer; the data hooks
 * (`useCreateCall`, `useEndCall`) read this context and drive the lifecycle
 * transitions on it, so there is one source of truth for "is a call up".
 *
 * There is no visible UI here yet. Later issues render the keypad, the in-call
 * controls, and the history pages that CONSUME this state through `useDialer()`.
 */
export function DialerProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<DialerView>('collapsed')
  const [phase, setPhase] = useState<CallPhase>('idle')
  // A call is up. Kept as its own flag rather than derived from `phase` because
  // it is what the timer effect keys off, and the two hooks set it alongside the
  // phase they move to.
  const [dialing, setDialing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const expandDialer = useCallback(() => setView('expanded'), [])
  const collapseDialer = useCallback(() => setView('collapsed'), [])

  const startCall = useCallback(() => {
    // Reset the timer FIRST, so a second call started right after the first ends
    // begins at 0 rather than inheriting the previous call's count.
    setElapsedSeconds(0)
    setPhase('ringing')
    setDialing(true)
    // Show the call the moment it is placed — a call ringing behind a collapsed
    // pill would read as a click that did nothing.
    setView('expanded')
  }, [])

  const connectCall = useCallback(() => setPhase('in-progress'), [])

  const endCall = useCallback(() => {
    // `dialing` goes false, which tears down the interval below and freezes
    // `elapsedSeconds` at the call's final length rather than zeroing it — the
    // rep still sees how long the call ran.
    setPhase('completed')
    setDialing(false)
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setDialing(false)
    setElapsedSeconds(0)
  }, [])

  // The call timer. One interval, alive only while a call is up, and always torn
  // down: when `dialing` flips false the cleanup clears it, and it never runs at
  // all before the first call. Depending on `dialing` alone (not `elapsedSeconds`)
  // keeps the same interval across every tick instead of rebuilding it each second.
  useEffect(() => {
    if (!dialing) return
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [dialing])

  // Keypad until a call is live, in-call controls while it is. Completed counts as
  // no-live-call, so the dialer returns to the keypad once a call ends.
  const mode = useMemo<DialerMode>(
    () => (phase === 'ringing' || phase === 'in-progress' ? 'call' : 'keypad'),
    [phase],
  )

  const value = useMemo<DialerContextValue>(
    () => ({
      view,
      phase,
      mode,
      dialing,
      elapsedSeconds,
      expandDialer,
      collapseDialer,
      startCall,
      connectCall,
      endCall,
      reset,
    }),
    [
      view,
      phase,
      mode,
      dialing,
      elapsedSeconds,
      expandDialer,
      collapseDialer,
      startCall,
      connectCall,
      endCall,
      reset,
    ],
  )

  return <DialerContext.Provider value={value}>{children}</DialerContext.Provider>
}
