import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, Wifi, WifiOff } from 'lucide-react'

import { Meter } from '@/components/DeviceCheck_Meter'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useGetDevices, useNetworkStatus, type AudioDevice } from '@/hooks/devices'
import { readDeviceChoice, resolveDeviceId, saveDeviceChoice } from '@/lib/deviceStorage'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Audio plumbing
// ---------------------------------------------------------------------------

/** Beep shape. Seconds, because that is what the Web Audio clock speaks. */
const BEEP_FREQUENCY_HZ = 440
const BEEP_PEAK_GAIN = 0.15
const BEEP_RAMP_S = 0.02
const BEEP_HOLD_S = 0.26
const BEEP_END_S = BEEP_RAMP_S * 2 + BEEP_HOLD_S

/** Above this RMS a frame counts as "real signal", not noise floor. */
const HEARD_THRESHOLD = 0.02

/** How long a selected, permitted microphone can stay silent before the nudge shows. */
const SILENCE_NUDGE_MS = 4_000

/** Speech sits well under full scale; tripling RMS puts normal talking mid-meter. */
const METER_GAIN = 3

/**
 * `setSinkId` is standardized on `HTMLMediaElement`, not on `AudioContext` — the
 * beep has to reach the chosen speaker through an `<audio>` element playing a
 * `MediaStreamAudioDestinationNode`, the same route `browserCanChooseSpeaker`
 * below actually feature-detects. Chrome and Edge implement it; TypeScript's
 * DOM lib does not know about it yet.
 */
type SinkCapableMediaElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const legacy = (window as Window & { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext
  return window.AudioContext ?? legacy ?? null
}

/**
 * Whether this browser can send audio to a speaker the rep picked.
 *
 * Chrome and Edge implement `HTMLMediaElement.setSinkId`; Firefox and Safari do
 * not, and there is no shim for it. Without it a speaker dropdown would be a
 * control that does nothing, which CLAUDE.md forbids — so this gates it, and
 * the picker says why it is disabled.
 */
function browserCanChooseSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

/** Root-mean-square of one analyser frame, 0…1. */
function frameLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const centered = (buffer[i] - 128) / 128
    sum += centered * centered
  }
  return Math.sqrt(sum / buffer.length)
}

/** RMS is quiet by nature — amplify and clamp so the meter reads as a real level. */
function meterLevel(rms: number): number {
  return Math.min(1, rms * METER_GAIN)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DeviceSelection {
  microphoneId: string | null
  speakerId: string | null
}

export interface DeviceCheckProps {
  /** Fires whenever the resolved microphone or speaker changes. */
  onSelectionChange?: (selection: DeviceSelection) => void
  className?: string
}

/**
 * The pre-call device check: pick a microphone and a speaker, see the meter
 * move, and prove both work before dialling.
 *
 * One row per device — a `Select` plus its own meter, with an inline note only
 * when something needs saying. The microphone meter is live the instant a
 * working, permitted mic is selected; there is no manual "Test" button for it.
 * The speaker still needs a press, because there is no way to read back what
 * came out of it.
 *
 * Self-contained on purpose — `GreenRoom` drops it into a modal, but it renders
 * and works standing on its own.
 */
export function DeviceCheck({ onSelectionChange, className }: DeviceCheckProps) {
  const { microphones, speakers, isLoading, error, refetch } = useGetDevices()
  const { online } = useNetworkStatus()

  // The rep's *preference*, which is not always the device in front of them.
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState<string | null>(
    () => readDeviceChoice().microphoneId,
  )
  const [preferredSpeakerId, setPreferredSpeakerId] = useState<string | null>(
    () => readDeviceChoice().speakerId,
  )

  const canChooseSpeaker = browserCanChooseSpeaker()
  const canPlayAudio = getAudioContextCtor() !== null

  // What the pickers actually show, derived rather than stored: a saved device
  // that is no longer plugged in falls back to the system default, and it does
  // so on the very first render, so the dropdown never points at hardware that
  // is not there. The fallback is never written back to storage — the rep's
  // headset may be plugged in again tomorrow, and the preference should survive
  // the gap and win again when it does.
  const microphoneId = resolveDeviceId(preferredMicrophoneId, microphones)
  const speakerId = resolveDeviceId(preferredSpeakerId, speakers)

  const selectionListener = useRef(onSelectionChange)
  useEffect(() => {
    selectionListener.current = onSelectionChange
  }, [onSelectionChange])
  useEffect(() => {
    selectionListener.current?.({ microphoneId, speakerId })
  }, [microphoneId, speakerId])

  // -------------------------------------------------------------------------
  // Microphone: continuous listening, no button.
  // -------------------------------------------------------------------------

  const [micLevel, setMicLevel] = useState(0)
  const [micSilent, setMicSilent] = useState(false)

  const micRun = useRef<{
    stream: MediaStream | null
    context: AudioContext | null
    frame: number | null
  }>({ stream: null, context: null, frame: null })
  const micRunIdRef = useRef(0)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopMicListening = useCallback(() => {
    micRunIdRef.current += 1
    const held = micRun.current
    if (held.frame !== null) cancelAnimationFrame(held.frame)
    held.stream?.getTracks().forEach((track) => track.stop())
    void held.context?.close?.()
    micRun.current = { stream: null, context: null, frame: null }
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    stopMicListening()
    // Deferred a tick, the same way DialerProvider defers its own: a state
    // update belongs in a callback an external system invokes, not
    // synchronously in the effect body itself (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setMicLevel(0)
      setMicSilent(false)
    })

    if (isLoading || !microphoneId || !canPlayAudio) return

    const Ctor = getAudioContextCtor()
    if (!Ctor) return

    const runId = ++micRunIdRef.current
    const isCurrent = () => runId === micRunIdRef.current

    void (async () => {
      const media = navigator.mediaDevices
      if (!media?.getUserMedia) return

      let stream: MediaStream
      try {
        try {
          stream = await media.getUserMedia({ audio: { deviceId: { exact: microphoneId } } })
        } catch {
          // The chosen device may have been unplugged between the read and now.
          stream = await media.getUserMedia({ audio: true })
        }
      } catch {
        // Nothing opened. The meter stays at zero, and the silence nudge below
        // covers this the same way it covers a device that opened but never
        // heard anything — there is no separate error line to keep in sync.
        return
      }

      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const context = new Ctor()
      micRun.current.stream = stream
      micRun.current.context = context

      // Not detected within the window: nudge the rep toward another device.
      silenceTimerRef.current = setTimeout(() => {
        if (isCurrent()) setMicSilent(true)
      }, SILENCE_NUDGE_MS)

      try {
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))

        const tick = () => {
          if (!isCurrent()) return
          const value = frameLevel(analyser, buffer)
          setMicLevel(value)
          if (value >= HEARD_THRESHOLD) {
            setMicSilent(false)
            if (silenceTimerRef.current !== null) {
              clearTimeout(silenceTimerRef.current)
              silenceTimerRef.current = null
            }
          }
          micRun.current.frame = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Opened but unreadable — same fallback as above: the silence nudge
        // covers it, since the level never leaves zero.
      }
    })()

    return () => stopMicListening()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopMicListening is stable (empty deps)
  }, [microphoneId, isLoading, canPlayAudio])

  useEffect(() => stopMicListening, [stopMicListening])

  // -------------------------------------------------------------------------
  // Speaker: a single test press, an envelope tied to the actual tone.
  // -------------------------------------------------------------------------

  const [speakerLevel, setSpeakerLevel] = useState(0)
  const [speakerTesting, setSpeakerTesting] = useState(false)
  const [speakerTested, setSpeakerTested] = useState(false)

  const speakerRun = useRef<{
    context: AudioContext | null
    audio: HTMLAudioElement | null
    frame: number | null
    timer: ReturnType<typeof setTimeout> | null
  }>({ context: null, audio: null, frame: null, timer: null })
  const speakerRunIdRef = useRef(0)

  const stopSpeakerTest = useCallback(() => {
    speakerRunIdRef.current += 1
    const held = speakerRun.current
    if (held.frame !== null) cancelAnimationFrame(held.frame)
    if (held.timer !== null) clearTimeout(held.timer)
    held.audio?.pause()
    if (held.audio) held.audio.srcObject = null
    void held.context?.close?.()
    speakerRun.current = { context: null, audio: null, frame: null, timer: null }
    setSpeakerLevel(0)
    setSpeakerTesting(false)
  }, [])

  useEffect(() => stopSpeakerTest, [stopSpeakerTest])

  const testSpeaker = useCallback(async () => {
    stopSpeakerTest()
    const runId = speakerRunIdRef.current
    const isCurrent = () => runId === speakerRunIdRef.current

    setSpeakerTesting(true)
    // Output can't be verified the way input can, so this always appears —
    // it is a reminder, not an error state.
    setSpeakerTested(true)

    const Ctor = getAudioContextCtor()
    if (!Ctor) {
      setSpeakerTesting(false)
      return
    }

    const context = new Ctor()
    speakerRun.current.context = context

    try {
      await context.resume?.()
      if (!isCurrent()) return

      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const analyser = context.createAnalyser()
      const destination = context.createMediaStreamDestination()
      analyser.fftSize = 2048
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, now)
      // Ramp both ends. Starting and stopping at full volume is a click, not a
      // tone, and a rep who hears a click cannot tell the speaker really works.
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(BEEP_PEAK_GAIN, now + BEEP_RAMP_S)
      gain.gain.setValueAtTime(BEEP_PEAK_GAIN, now + BEEP_RAMP_S + BEEP_HOLD_S)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_END_S)
      oscillator.connect(gain)
      // The meter reads the same signal that reaches the speaker, so its
      // envelope is the beep's own envelope, not a stand-in animation.
      gain.connect(analyser)
      // `setSinkId` is only standardized on a media element, not on the audio
      // context, so the tone has to leave through one: the graph renders into
      // a `MediaStreamAudioDestinationNode`, and an `<audio>` element plays
      // that stream on the chosen output device.
      analyser.connect(destination)
      oscillator.start(now)
      oscillator.stop(now + BEEP_END_S)

      const audio: SinkCapableMediaElement = new Audio()
      audio.srcObject = destination.stream
      speakerRun.current.audio = audio
      if (canChooseSpeaker && speakerId && typeof audio.setSinkId === 'function') {
        await audio.setSinkId(speakerId)
      }
      if (!isCurrent()) return
      await audio.play()

      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      const tick = () => {
        if (!isCurrent()) return
        setSpeakerLevel(frameLevel(analyser, buffer))
        speakerRun.current.frame = requestAnimationFrame(tick)
      }
      tick()

      speakerRun.current.timer = setTimeout(() => {
        if (isCurrent()) stopSpeakerTest()
      }, BEEP_END_S * 1000)
    } catch {
      if (isCurrent()) stopSpeakerTest()
    }
  }, [canChooseSpeaker, speakerId, stopSpeakerTest])

  // -------------------------------------------------------------------------
  // Choices
  // -------------------------------------------------------------------------

  function chooseMicrophone(next: string) {
    setPreferredMicrophoneId(next)
    saveDeviceChoice({ microphoneId: next })
  }

  function chooseSpeaker(next: string) {
    setPreferredSpeakerId(next)
    saveDeviceChoice({ speakerId: next })
    setSpeakerTested(false)
  }

  // -------------------------------------------------------------------------
  // Row state
  // -------------------------------------------------------------------------

  const usableMicrophones = microphones.filter((device) => device.deviceId.length > 0)
  const micRowDisabled = isLoading || usableMicrophones.length === 0
  const micNote = micRowDisabled
    ? 'No microphone found. Plug one in, then choose it here.'
    : micSilent
      ? "We're not picking up any sound. Try picking another microphone above."
      : null

  const usableSpeakers = canChooseSpeaker ? speakers.filter((device) => device.deviceId.length > 0) : []
  const speakerRowDisabled = isLoading || !canChooseSpeaker || usableSpeakers.length === 0
  const speakerNote = !canChooseSpeaker
    ? "Your browser can't switch speakers — change it in your system settings."
    : speakerRowDisabled
      ? 'No speaker found. Plug one in, then choose it here.'
      : speakerTested
        ? "Didn't hear anything? Choose another speaker above."
        : null

  return (
    <section
      className={cn('flex max-w-md flex-col gap-4', className)}
      aria-labelledby="deviceCheckTitle"
    >
      <h2 id="deviceCheckTitle" className="text-sm font-semibold">
        Check your audio
      </h2>

      <PermissionStatus isLoading={isLoading} error={error} onRetry={refetch} />
      <NetworkStatusLine online={online} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deviceCheckMicrophone">Microphone</Label>
          <div className="flex items-center gap-2">
            <DeviceSelect
              id="deviceCheckMicrophone"
              label="Microphone"
              devices={usableMicrophones}
              value={microphoneId}
              onChange={chooseMicrophone}
              disabled={micRowDisabled}
            />
            <Meter level={meterLevel(micLevel)} label="Microphone level" />
          </div>
          {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deviceCheckSpeaker">Speaker</Label>
          <div className="flex items-center gap-2">
            <DeviceSelect
              id="deviceCheckSpeaker"
              label="Speaker"
              devices={usableSpeakers}
              value={canChooseSpeaker ? speakerId : null}
              onChange={chooseSpeaker}
              disabled={speakerRowDisabled}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void testSpeaker()}
              disabled={!canPlayAudio || speakerRowDisabled || speakerTesting || !speakerId}
            >
              Test speaker
            </Button>
            <Meter level={meterLevel(speakerLevel)} label="Speaker level" />
          </div>
          {speakerNote && <p className="text-xs text-muted-foreground">{speakerNote}</p>}
        </div>
      </div>

      {!canPlayAudio && (
        <p className="text-xs text-muted-foreground">
          Your browser can&rsquo;t play test audio. Open Maincar in Chrome or Edge.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * A name for a device the browser may not have named.
 *
 * `label` is empty until the page holds microphone permission, and some
 * browsers withhold it for the default device even then, so never render it raw.
 */
function deviceLabel(device: AudioDevice, index: number, kind: string): string {
  if (device.label) return device.label
  if (device.deviceId === 'default') return `Default ${kind.toLowerCase()}`
  return `${kind} ${index + 1}`
}

/**
 * Granted, denied, or pending — an icon plus words, never colour alone.
 *
 * On failure it shows `useGetDevices`'s own sentence verbatim. That string is
 * already written to name the rep's next action, so wrapping it in a generic
 * message would only bury the instruction.
 */
function PermissionStatus({
  isLoading,
  error,
  onRetry,
}: {
  isLoading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle
          size={16}
          aria-hidden="true"
          className="shrink-0 animate-spin motion-reduce:animate-none"
        />
        Checking your microphone.
      </p>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-sm text-status-failed">
        <span className="flex h-5 shrink-0 items-center">
          <CircleAlert size={16} aria-hidden="true" />
        </span>
        <span className="flex flex-col items-start gap-2">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      </div>
    )
  }

  return (
    <p className="flex items-center gap-2 text-sm text-status-success">
      <CircleCheck size={16} aria-hidden="true" className="shrink-0" />
      Microphone allowed.
    </p>
  )
}

/**
 * A rep who blames a dead microphone when the real problem is no network
 * connection needs that ruled out first, not last. Colour is never the only
 * signal — the words carry it too.
 */
function NetworkStatusLine({ online }: { online: boolean }) {
  if (online) {
    return (
      <p className="flex items-center gap-2 text-sm text-status-success">
        <Wifi size={16} aria-hidden="true" className="shrink-0" />
        Connected.
      </p>
    )
  }

  return (
    <p className="flex items-center gap-2 text-sm text-status-failed">
      <WifiOff size={16} aria-hidden="true" className="shrink-0" />
      No internet connection. Check your network, then try again.
    </p>
  )
}

function DeviceSelect({
  id,
  label,
  devices,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  devices: AudioDevice[]
  value: string | null
  onChange: (next: string) => void
  disabled: boolean
}) {
  const isDisabled = disabled || devices.length === 0

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={isDisabled}>
      <SelectTrigger id={id} size="sm" className="w-0 flex-1">
        <SelectValue placeholder={`No ${label.toLowerCase()} available`} />
      </SelectTrigger>
      <SelectContent>
        {devices.map((device, index) => (
          <SelectItem key={device.deviceId} value={device.deviceId}>
            {deviceLabel(device, index, label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
