import { createContext, useContext } from 'react'

/**
 * Kept apart from `DialerProvider.tsx` for the same reason `useAuth.ts` is kept
 * apart from `AuthProvider.tsx`: a module that exports both a component and a
 * non-component breaks fast refresh and trips `eslint-plugin-react-refresh`.
 *
 * `DialerProvider` owns the state and the elapsed-seconds timer. This file is the
 * read side — the context object and the `useDialer()` hook every keypad,
 * control, and call button reads it through. The data hooks (`useCreateCall`,
 * `useEndCall`) read it too, and drive the call-lifecycle transitions below.
 */

/** The dialer widget's size. Collapsed is a pill; expanded shows the keypad or the call. */
export type DialerView = 'collapsed' | 'expanded'

/**
 * Where a call is in its life. Mirrors the subset of `Call.status` the dialer
 * cares about: `ringing` and `in-progress` are the two live states, `completed`
 * is any ended call, and `idle` is the rest state with no call at all.
 */
export type CallPhase = 'idle' | 'ringing' | 'in-progress' | 'completed'

/**
 * What the expanded dialer shows. Derived from `phase`, never set directly: the
 * keypad while there is no live call, the in-call controls while there is one.
 */
export type DialerMode = 'keypad' | 'call'

export interface DialerContextValue {
  /** The widget's size. */
  view: DialerView
  /** Where the current call is in its life, or `idle` when there is none. */
  phase: CallPhase
  /** Keypad or in-call controls, derived from `phase`. */
  mode: DialerMode
  /** True while a call is live — from a placed call until it ends. Drives the timer. */
  dialing: boolean
  /** Whole seconds since the live call started. 0 when idle; frozen once it ends. */
  elapsedSeconds: number

  /** Open the dialer to full size. */
  expandDialer: () => void
  /** Shrink the dialer back to its pill. */
  collapseDialer: () => void

  // --- Call-lifecycle transitions, driven by the data hooks ---
  // These move the shared dialer state so `useCreateCall`/`useEndCall` update one
  // source of truth rather than each holding a private copy. They are the reason
  // the context is not read-only.

  /**
   * A call has been placed: go to `ringing`, mark the dialer live, reset the
   * timer to 0, and expand the widget so the rep sees the call. `useCreateCall`
   * calls this once the POST succeeds.
   */
  startCall: () => void
  /** The callee answered: go to `in-progress`. Wired for the status webhook to drive. */
  connectCall: () => void
  /**
   * The call ended: go to `completed` and stop the timer, freezing
   * `elapsedSeconds` at its last value. `useEndCall` calls this on a successful
   * hang-up.
   */
  endCall: () => void
  /** Back to the rest state: `idle`, not dialing, timer at 0, ready for the next call. */
  reset: () => void
}

export const DialerContext = createContext<DialerContextValue | null>(null)

/**
 * The dialer state, or null outside the provider.
 *
 * For components that render both inside the dialer and on their own in a test,
 * where a throw would fail the test for a reason unrelated to what it checks.
 */
export function useDialerOptional(): DialerContextValue | null {
  return useContext(DialerContext)
}

/**
 * The dialer state. Throws outside the provider, because a call button that
 * silently did nothing would look like a broken control rather than a missing
 * provider.
 */
export function useDialer(): DialerContextValue {
  const value = useContext(DialerContext)
  if (!value) {
    throw new Error('useDialer must be used inside <DialerProvider>.')
  }
  return value
}
