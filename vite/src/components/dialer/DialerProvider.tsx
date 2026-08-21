import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Device, type TwilioVoiceCall } from '@/dependencies/twilioVoice'
import { useAuth } from '@/providers/useAuth'
import { useGetVoiceToken } from '@/hooks/dialer/useGetVoiceToken'
import {
  DialerContext,
  type ActiveCall,
  type CallPhase,
  type DialerContextValue,
  type DialerMode,
  type DialerView,
} from './dialerContext'

/**
 * The dialer's shared state, mounted once high in the tree so a call survives
 * navigation the way the composer's cards do. It holds the widget's size, where
 * the current call is in its life, the running call timer, and the rep's browser
 * Voice SDK Device; the data hooks (`useCreateCall`, `useEndCall`) read this
 * context and drive the lifecycle transitions on it, so there is one source of
 * truth for "is a call up".
 *
 * Later issues render the keypad, the in-call controls, and the history pages
 * that CONSUME this state through `useDialer()`.
 */
export function DialerProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<DialerView>('collapsed')
  const [phase, setPhase] = useState<CallPhase>('idle')
  // A call is up. Kept as its own flag rather than derived from `phase` because
  // it is what the timer effect keys off, and the two hooks set it alongside the
  // phase they move to.
  const [dialing, setDialing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  // The live call's identity, so the in-call controls can hang it up. Set when a
  // call is placed, cleared at reset.
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  // The live Voice SDK Call object placeDeviceCall connected, so mute/DTMF can
  // reach it directly (MAI-195). Set once `device.connect()` resolves; cleared by
  // endCall and reset, which run on every path off a live call.
  const callRef = useRef<TwilioVoiceCall | null>(null)

  const expandDialer = useCallback(() => setView('expanded'), [])
  const collapseDialer = useCallback(() => setView('collapsed'), [])
  const toggleView = useCallback(
    () => setView((v) => (v === 'expanded' ? 'collapsed' : 'expanded')),
    [],
  )

  const startCall = useCallback((call?: ActiveCall) => {
    // Reset the timer FIRST, so a second call started right after the first ends
    // begins at 0 rather than inheriting the previous call's count.
    setElapsedSeconds(0)
    setActiveCall(call ?? null)
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
    callRef.current = null
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setDialing(false)
    setElapsedSeconds(0)
    setActiveCall(null)
    callRef.current = null
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

  // --- The rep's browser Voice SDK Device ---
  // One Device per rep, built lazily from a minted access token and kept for the
  // whole session — never rebuilt per call, so a second call does not pay a fresh
  // WebRTC setup cost. `@twilio/voice-sdk` is imported nowhere but
  // `dependencies/twilioVoice.ts` (CLAUDE.md → Third-party APIs / SDKs).
  const { org } = useAuth()
  const { data: voiceToken, refetch: refetchVoiceToken } = useGetVoiceToken(org?.id)
  const deviceRef = useRef<Device | null>(null)

  useEffect(() => {
    if (!voiceToken) return
    if (deviceRef.current) {
      deviceRef.current.updateToken(voiceToken.token)
      return
    }
    const device = new Device(voiceToken.token)
    // The SDK's own warning that the token is about to expire — refresh from the
    // server rather than guessing a lifetime, so a long session never hits a
    // token that quietly stopped working mid-call.
    device.on('tokenWillExpire', () => void refetchVoiceToken())
    device.on('error', (error: { message?: string }) => {
      toast.error(error.message ?? 'The dialer lost its connection. Reload the page and try again.')
    })
    deviceRef.current = device
  }, [voiceToken, refetchVoiceToken])

  // Torn down on unmount only — the Device outlives any one call.
  useEffect(
    () => () => {
      deviceRef.current?.destroy()
      deviceRef.current = null
    },
    [],
  )

  // Places one call through the Device and wires that call's OWN lifecycle onto
  // the shared dialer state: 'accept' is the callee actually answering,
  // 'disconnect'/'cancel'/'reject'/'error' are every way a call ends before or
  // after that. This is what makes `phase` track a real call instead of an
  // optimistic guess.
  const placeDeviceCall = useCallback(
    async (params: Record<string, string>) => {
      const device = deviceRef.current
      if (!device) {
        throw new Error('The dialer is still starting up. Wait a moment and try again.')
      }
      const call: TwilioVoiceCall = await device.connect({ params })
      callRef.current = call
      call.on('accept', () => connectCall())
      call.on('disconnect', () => endCall())
      call.on('cancel', () => endCall())
      call.on('reject', () => endCall())
      call.on('error', () => endCall())
    },
    [connectCall, endCall],
  )

  // Mute/DTMF: forward straight to the live Call object callRef holds. See the
  // context doc on each for the no-call-up behavior.
  const muteCall = useCallback((next: boolean) => {
    callRef.current?.mute(next)
  }, [])

  const sendDigits = useCallback((digit: string) => {
    callRef.current?.sendDigits(digit)
  }, [])

  const value = useMemo<DialerContextValue>(
    () => ({
      view,
      phase,
      mode,
      dialing,
      elapsedSeconds,
      activeCall,
      expandDialer,
      collapseDialer,
      toggleView,
      startCall,
      connectCall,
      endCall,
      reset,
      placeDeviceCall,
      muteCall,
      sendDigits,
    }),
    [
      view,
      phase,
      mode,
      dialing,
      elapsedSeconds,
      activeCall,
      expandDialer,
      collapseDialer,
      toggleView,
      startCall,
      connectCall,
      endCall,
      reset,
      placeDeviceCall,
      muteCall,
      sendDigits,
    ],
  )

  return <DialerContext.Provider value={value}>{children}</DialerContext.Provider>
}
