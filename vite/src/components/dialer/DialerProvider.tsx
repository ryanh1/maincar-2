import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Device, type TwilioVoiceCall } from '@/dependencies/twilioVoice'
import { useAuth } from '@/providers/useAuth'
import { useGetCallDetail } from '@/hooks/dialer/useGetCallDetail'
import { useGetVoiceToken } from '@/hooks/dialer/useGetVoiceToken'
import type { CallStatus } from '@/lib/callTypes'
import { callOutcomeMessage } from '@/lib/callOutcomeMessage'
import {
  DialerContext,
  type ActiveCall,
  type AutoDispositionStatus,
  type CallPhase,
  type DialerContextValue,
  type DialerMode,
  type DialerView,
} from './dialerContext'

/**
 * The statuses `POST /api/twilio/voice/status` (server/src/routes/twilioVoice.ts)
 * never comes back from. Mirrors `TERMINAL_CALL_STATUSES` there — the client's
 * own copy, since the two are separate deployables.
 */
const TERMINAL_CALL_STATUSES = new Set<CallStatus>([
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
])

/** How often the dialer polls the server for the live call's real status (MAI-190). */
const CALL_STATUS_POLL_MS = 2500

const ACTIVE_CALL_STORAGE_KEY = 'maincar.dialer.active-call'

interface StoredActiveCall {
  activeCall: ActiveCall
  phase: Extract<CallPhase, 'ringing' | 'in-progress'>
  elapsedSeconds: number
}

function isStoredActiveCall(value: unknown, orgId: string): value is StoredActiveCall {
  if (!value || typeof value !== 'object') return false
  const stored = value as Partial<StoredActiveCall>
  const call = stored.activeCall
  return (
    !!call &&
    typeof call === 'object' &&
    call.orgId === orgId &&
    typeof call.callId === 'string' &&
    typeof call.recording === 'boolean' &&
    (stored.phase === 'ringing' || stored.phase === 'in-progress') &&
    typeof stored.elapsedSeconds === 'number' &&
    stored.elapsedSeconds >= 0
  )
}

function readStoredActiveCall(orgId: string): StoredActiveCall | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY)
    if (!raw) return null
    const stored: unknown = JSON.parse(raw)
    return isStoredActiveCall(stored, orgId) ? stored : null
  } catch {
    return null
  }
}

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
  const { org } = useAuth()
  const [view, setView] = useState<DialerView>('collapsed')
  const [prefilledNumber, setPrefilledNumber] = useState<string | undefined>()
  const [phase, setPhase] = useState<CallPhase>('idle')
  // A call is up. Kept as its own flag rather than derived from `phase` because
  // it is what the timer effect keys off, and the two hooks set it alongside the
  // phase they move to.
  const [dialing, setDialing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [terminalStatus, setTerminalStatus] = useState<AutoDispositionStatus | null>(null)
  // The live call's identity, so the in-call controls can hang it up. Set when a
  // call is placed, cleared at reset.
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  // The Voice SDK object exists only in the browser tab that placed the call. A
  // recovered call can still be ended through the server, but cannot truthfully
  // offer mute or DTMF through a Call object this tab does not own.
  const [canControlAudio, setCanControlAudio] = useState(false)
  // The live Voice SDK Call object placeDeviceCall connected, so mute/DTMF can
  // reach it directly (MAI-195). Set once `device.connect()` resolves; cleared by
  // endCall and reset, which run on every path off a live call.
  const callRef = useRef<TwilioVoiceCall | null>(null)
  // End can land between startCall and Device.connect resolving. This flag must
  // survive reset: the pending promise checks it before it can create a browser
  // leg and ring the callee. Only a fresh call is allowed to clear it.
  const canceledRef = useRef(false)
  // A terminal status can arrive through the SDK and the server poll almost
  // together. Handle it once so the dialer does not emit two errors or reset
  // the final duration twice.
  const terminalRef = useRef(false)
  // Whether THIS call has already reset the timer at answer. The Device's own
  // `accept` event and the server-status poll below can each report the callee
  // answered, and only the first one to do so should zero the timer — a second
  // report must not restart it mid-call. Cleared on every path onto a fresh call.
  const answeredRef = useRef(false)
  const serverStartedAtRef = useRef<string | null>(null)
  const restoredOrgRef = useRef<string | null>(null)

  const expandDialer = useCallback((number?: string) => {
    setPrefilledNumber(number)
    setView('expanded')
  }, [])
  const collapseDialer = useCallback(() => setView('collapsed'), [])
  const toggleView = useCallback(
    () => setView((v) => (v === 'expanded' ? 'collapsed' : 'expanded')),
    [],
  )

  const startCall = useCallback((call?: ActiveCall) => {
    // Reset the timer FIRST, so a second call started right after the first ends
    // begins at 0 rather than inheriting the previous call's count.
    setElapsedSeconds(0)
    answeredRef.current = false
    serverStartedAtRef.current = null
    canceledRef.current = false
    terminalRef.current = false
    setTerminalStatus(null)
    setActiveCall(call ?? null)
    setCanControlAudio(false)
    setPhase('ringing')
    setDialing(true)
    // Show the call the moment it is placed — a call ringing behind a collapsed
    // pill would read as a click that did nothing.
    setView('expanded')
  }, [])

  const adoptCall = useCallback((call: ActiveCall, status: CallStatus) => {
    if (!['queued', 'ringing', 'in-progress'].includes(status)) return
    setElapsedSeconds(0)
    answeredRef.current = false
    serverStartedAtRef.current = null
    setTerminalStatus(null)
    setActiveCall(call)
    setCanControlAudio(false)
    setPhase(status === 'in-progress' ? 'in-progress' : 'ringing')
    setDialing(true)
    setView('expanded')
  }, [])

  const connectCall = useCallback((startedAt?: string | null) => {
    // The timer counts from answer, not from placement (MAI-190) — reset it here,
    // the first time this call is reported connected, rather than at startCall.
    // A server timestamp wins over a local estimate after adoption or refresh.
    if (startedAt && serverStartedAtRef.current !== startedAt) {
      const milliseconds = Date.parse(startedAt)
      if (!Number.isNaN(milliseconds)) {
        serverStartedAtRef.current = startedAt
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - milliseconds) / 1000)))
      }
    } else if (!answeredRef.current) {
      answeredRef.current = true
      setElapsedSeconds(0)
    }
    answeredRef.current = true
    setPhase('in-progress')
  }, [])

  const endCall = useCallback((durationS?: number, nextTerminalStatus?: AutoDispositionStatus | null) => {
    // `dialing` goes false, which tears down the interval below and freezes
    // `elapsedSeconds` at the call's final length. When the caller knows the
    // server's billed duration, show that exact value instead of the local
    // estimate (MAI-190) — otherwise the local count stands, as before.
    terminalRef.current = true
    setPhase('completed')
    setDialing(false)
    if (typeof durationS === 'number') setElapsedSeconds(durationS)
    if (nextTerminalStatus) setTerminalStatus(nextTerminalStatus)
    callRef.current = null
    setCanControlAudio(false)
  }, [])

  const finishCall = useCallback(
    (status?: CallStatus | 'dropped', durationS?: number) => {
      if (terminalRef.current) return
      terminalRef.current = true
      const message = status === 'busy' || status === 'no-answer' || status === 'failed' || status === 'dropped'
        ? callOutcomeMessage(status)
        : undefined
      if (message && !canceledRef.current) toast.error(message)
      endCall(durationS, status === 'busy' || status === 'no-answer' || status === 'failed' ? status : null)
    },
    [endCall],
  )

  const cancelCall = useCallback(() => {
    canceledRef.current = true
    callRef.current?.disconnect()
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setDialing(false)
    setElapsedSeconds(0)
    answeredRef.current = false
    serverStartedAtRef.current = null
    setTerminalStatus(null)
    setActiveCall(null)
    callRef.current = null
    setCanControlAudio(false)
  }, [])

  // A same-tab refresh loses React state but not sessionStorage. Restore only a
  // live call from the active organization, then let the normal detail poll
  // reconcile its current status and exact startedAt.
  useEffect(() => {
    if (!org) return

    if (restoredOrgRef.current !== org.id) {
      restoredOrgRef.current = org.id
      const stored = readStoredActiveCall(org.id)
      queueMicrotask(() => {
        // An organization switch can happen before this callback runs. In that
        // case its own effect owns the restore, so this stale session must not
        // overwrite it.
        if (restoredOrgRef.current !== org.id) return
        if (stored) {
          answeredRef.current = stored.phase === 'in-progress'
          setActiveCall(stored.activeCall)
          setPhase(stored.phase)
          setElapsedSeconds(stored.elapsedSeconds)
          setDialing(true)
          setCanControlAudio(false)
          setView('expanded')
        } else {
          setActiveCall(null)
          setPhase('idle')
          setElapsedSeconds(0)
          setDialing(false)
          setCanControlAudio(false)
        }
      })
      return
    }

    try {
      if (dialing && activeCall && (phase === 'ringing' || phase === 'in-progress')) {
        sessionStorage.setItem(
          ACTIVE_CALL_STORAGE_KEY,
          JSON.stringify({ activeCall, phase, elapsedSeconds } satisfies StoredActiveCall),
        )
      } else {
        sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY)
      }
    } catch {
      // Storage can be unavailable in a privacy-restricted browser. The live
      // call remains usable for this session; only refresh recovery is skipped.
    }
  }, [org, activeCall, dialing, elapsedSeconds, phase])

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

  // --- Learn the call's real status from the server (MAI-190) ---
  // The Voice SDK Device only ever reports the BROWSER's own leg of the call —
  // nothing tells it what the bridged destination leg is actually doing, so a
  // remote hang-up, a busy signal, or a no-answer never reaches it. This is the
  // channel that closes that gap: while a call is up, poll the same call-detail
  // route the history page reads, and reconcile the server's `status` onto the
  // dialer's phase below. Disabled the instant `dialing` goes false — by any
  // path — so it never polls a call that already ended.
  const { data: liveCallDetail } = useGetCallDetail(
    dialing ? activeCall?.orgId : undefined,
    dialing ? activeCall?.callId : undefined,
    { refetchInterval: CALL_STATUS_POLL_MS },
  )

  useEffect(() => {
    const call = liveCallDetail?.call
    if (!call) return
    // Deferred a tick, the same way the timer effect's setInterval callback is:
    // a state update belongs in a callback the external system (react-query's
    // poll) invokes, not synchronously in the effect body itself
    // (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (call.status === 'in-progress') {
        connectCall(call.startedAt)
      } else if (TERMINAL_CALL_STATUSES.has(call.status)) {
        if (call.status === 'busy' || call.status === 'no-answer' || call.status === 'failed') {
          setTerminalStatus(call.status)
        }
        if (phase !== 'completed') finishCall(call.status, call.durationS ?? undefined)
      }
    })
  }, [liveCallDetail, phase, connectCall, finishCall])

  // --- The rep's browser Voice SDK Device ---
  // One Device per rep, built lazily from a minted access token and kept for the
  // whole session — never rebuilt per call, so a second call does not pay a fresh
  // WebRTC setup cost. `@twilio/voice-sdk` is imported nowhere but
  // `dependencies/twilioVoice.ts` (CLAUDE.md → Third-party APIs / SDKs).
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
      // The rep may have pressed End while Device.connect() was waiting. Do not
      // attach or keep that late call: dropping it immediately prevents the
      // canceled attempt from ringing the callee after the UI returned to idle.
      if (canceledRef.current) {
        call.disconnect()
        return
      }
      callRef.current = call
      setCanControlAudio(true)
      call.on('accept', () => connectCall())
      call.on('disconnect', () => finishCall())
      call.on('cancel', () => finishCall('no-answer'))
      call.on('reject', () => finishCall('busy'))
      call.on('error', () =>
        finishCall(answeredRef.current ? 'dropped' : 'failed'),
      )
    },
    [connectCall, finishCall],
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
      terminalStatus,
      activeCall,
      canControlAudio,
      prefilledNumber,
      expandDialer,
      collapseDialer,
      toggleView,
      startCall,
      adoptCall,
      connectCall,
      endCall,
      cancelCall,
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
      terminalStatus,
      activeCall,
      canControlAudio,
      prefilledNumber,
      expandDialer,
      collapseDialer,
      toggleView,
      startCall,
      adoptCall,
      connectCall,
      endCall,
      cancelCall,
      reset,
      placeDeviceCall,
      muteCall,
      sendDigits,
    ],
  )

  return <DialerContext.Provider value={value}>{children}</DialerContext.Provider>
}
