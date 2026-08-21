import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, Mic, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useGetDevices, type AudioDevice } from '@/hooks/devices'
import { readDeviceChoice, resolveDeviceId, saveDeviceChoice } from '@/lib/deviceStorage'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Audio plumbing
// ---------------------------------------------------------------------------

/** How long the microphone stays open during a test before it closes itself. */
const TEST_DURATION_MS = 5_000

/** Beep shape. Seconds, because that is what the Web Audio clock speaks. */
const BEEP_FREQUENCY_HZ = 440
const BEEP_PEAK_GAIN = 0.15
const BEEP_RAMP_S = 0.02
const BEEP_HOLD_S = 0.26
const BEEP_END_S = BEEP_RAMP_S * 2 + BEEP_HOLD_S

/** Above this RMS the meter counts as "the rep's voice registered". */
const HEARD_THRESHOLD = 0.02

/** Chrome exposes `setSinkId` on the context itself; other browsers do not. */
type SinkCapableAudioContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type BeepStatus = 'idle' | 'playing' | 'played' | 'failed'
type MicStatus = 'idle' | 'listening' | 'heard' | 'silent' | 'failed'

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
 * The pre-call device check: pick a microphone and a speaker, see whether the
 * browser will let Maincar hear you, and prove both work before dialling.
 *
 * Self-contained on purpose — MAI-22 drops it into a modal, but it renders and
 * works standing on its own.
 */
export function DeviceCheck({ onSelectionChange, className }: DeviceCheckProps) {
  const { microphones, speakers, isLoading, error, refetch } = useGetDevices()

  // The rep's *preference*, which is not always the device in front of them.
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState<string | null>(
    () => readDeviceChoice().microphoneId,
  )
  const [preferredSpeakerId, setPreferredSpeakerId] = useState<string | null>(
    () => readDeviceChoice().speakerId,
  )

  const [beep, setBeep] = useState<BeepStatus>('idle')
  const [mic, setMic] = useState<MicStatus>('idle')
  const [micProblem, setMicProblem] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [testing, setTesting] = useState(false)

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

  // Everything one test run holds open, so a single call releases all of it.
  const running = useRef<{
    stream: MediaStream | null
    context: AudioContext | null
    frame: number | null
    timer: ReturnType<typeof setTimeout> | null
  }>({ stream: null, context: null, frame: null, timer: null })
  // Bumped by every start and every stop, so a run whose awaits landed late
  // cannot write over the run that replaced it.
  const runIdRef = useRef(0)

  /**
   * Release the microphone and the audio context.
   *
   * A device check that leaves the mic hot is worse than no check: the browser's
   * recording indicator stays lit and the device stays captured for as long as
   * the page lives. Every exit path runs through here, including unmount.
   */
  const stopTest = useCallback(() => {
    runIdRef.current += 1
    const held = running.current
    if (held.frame !== null) cancelAnimationFrame(held.frame)
    if (held.timer !== null) clearTimeout(held.timer)
    held.stream?.getTracks().forEach((track) => track.stop())
    void held.context?.close?.()
    running.current = { stream: null, context: null, frame: null, timer: null }
    setLevel(0)
    setTesting(false)
  }, [])

  useEffect(() => stopTest, [stopTest])

  const startTest = useCallback(async () => {
    stopTest()
    const runId = runIdRef.current
    const isCurrent = () => runId === runIdRef.current

    setTesting(true)
    setBeep('playing')
    setMic('listening')
    setMicProblem(null)

    const Ctor = getAudioContextCtor()
    if (!Ctor) {
      setBeep('failed')
      setMic('failed')
      setMicProblem('This browser has no audio support. Open Maincar in Chrome or Edge.')
      stopTest()
      return
    }

    const context: SinkCapableAudioContext = new Ctor()
    running.current.context = context

    // --- the beep -----------------------------------------------------------
    try {
      await context.resume?.()
      if (canChooseSpeaker && speakerId && typeof context.setSinkId === 'function') {
        await context.setSinkId(speakerId)
      }
      if (!isCurrent()) return
      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, now)
      // Ramp both ends. Starting and stopping at full volume is a click, not a
      // tone, and a rep who hears a click cannot tell the speaker really works.
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(BEEP_PEAK_GAIN, now + BEEP_RAMP_S)
      gain.gain.setValueAtTime(BEEP_PEAK_GAIN, now + BEEP_RAMP_S + BEEP_HOLD_S)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_END_S)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + BEEP_END_S)
      setBeep('played')
    } catch {
      if (isCurrent()) setBeep('failed')
    }

    // --- the microphone -----------------------------------------------------
    let stream: MediaStream
    try {
      const media = navigator.mediaDevices
      if (!media?.getUserMedia) throw new Error('this browser cannot open a microphone')
      try {
        stream = await media.getUserMedia(
          microphoneId ? { audio: { deviceId: { exact: microphoneId } } } : { audio: true },
        )
      } catch {
        // The chosen device may have been unplugged between the read and now.
        // Fall back to the system default rather than fail the whole test.
        stream = await media.getUserMedia({ audio: true })
      }
    } catch {
      if (isCurrent()) {
        stopTest()
        setMic('failed')
        setMicProblem('Could not open that microphone. Pick another one, then test again.')
      }
      return
    }

    if (!isCurrent()) {
      // A newer run (or an unmount) replaced this one while getUserMedia was in
      // flight. Nothing else will release this stream, so release it here.
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    running.current.stream = stream

    let peak = 0
    try {
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))

      const tick = () => {
        if (!isCurrent()) return
        const value = frameLevel(analyser, buffer)
        peak = Math.max(peak, value)
        setLevel(value)
        if (peak >= HEARD_THRESHOLD) setMic('heard')
        running.current.frame = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      stopTest()
      setMic('failed')
      setMicProblem('Could not read that microphone. Pick another one, then test again.')
      return
    }

    running.current.timer = setTimeout(() => {
      const heard = peak >= HEARD_THRESHOLD
      stopTest()
      setMic(heard ? 'heard' : 'silent')
    }, TEST_DURATION_MS)
  }, [canChooseSpeaker, microphoneId, speakerId, stopTest])

  function chooseMicrophone(next: string) {
    setPreferredMicrophoneId(next)
    saveDeviceChoice({ microphoneId: next })
  }

  function chooseSpeaker(next: string) {
    setPreferredSpeakerId(next)
    saveDeviceChoice({ speakerId: next })
  }

  function onTestClick() {
    if (testing) {
      stopTest()
      return
    }
    void startTest()
  }

  // Speech sits well under full scale, so a raw RMS barely moves the bar. Three
  // times RMS puts normal talking around the middle of the meter.
  const levelPercent = testing ? Math.min(100, Math.round(level * 300)) : 0

  return (
    <section
      className={cn('flex max-w-md flex-col gap-4', className)}
      aria-labelledby="deviceCheckTitle"
    >
      <h2 id="deviceCheckTitle" className="text-sm font-semibold">
        Check your audio
      </h2>

      <PermissionStatus isLoading={isLoading} error={error} onRetry={refetch} />

      <div className="flex flex-col gap-3">
        <DevicePicker
          id="deviceCheckMicrophone"
          label="Microphone"
          devices={microphones}
          value={microphoneId}
          onChange={chooseMicrophone}
          disabled={isLoading}
          note="No microphone found. Plug one in, then choose it here."
        />

        <DevicePicker
          id="deviceCheckSpeaker"
          label="Speaker"
          // Firefox and Safari cannot route audio to a chosen speaker at all, so
          // the picker is emptied and disabled rather than left looking live.
          devices={canChooseSpeaker ? speakers : []}
          value={canChooseSpeaker ? speakerId : null}
          onChange={chooseSpeaker}
          disabled={isLoading || !canChooseSpeaker}
          note={
            canChooseSpeaker
              ? 'No speaker found. Plug one in, then choose it here.'
              : "Your browser can't switch speakers — change it in your system settings."
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onTestClick}
            disabled={!canPlayAudio || isLoading}
          >
            {testing ? 'Stop test' : 'Test'}
          </Button>
          <LevelMeter percent={levelPercent} />
        </div>

        {!canPlayAudio && (
          <p className="text-xs text-muted-foreground">
            Your browser can&rsquo;t play test audio. Open Maincar in Chrome or Edge.
          </p>
        )}

        {/* Two results, because the test does two things. Live, so a screen
            reader announces each one as it lands. */}
        <div aria-live="polite" className="flex flex-col gap-1">
          <ResultLine icon={<Volume2 size={16} aria-hidden="true" />} text={beepMessage(beep)} />
          <ResultLine
            icon={<Mic size={16} aria-hidden="true" />}
            text={micProblem ?? micMessage(mic)}
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function beepMessage(status: BeepStatus): string {
  if (status === 'idle') return 'Speaker: not tested yet.'
  if (status === 'playing') return 'Speaker: playing a beep.'
  if (status === 'played') return 'Speaker: beep played. Pick another speaker if you heard nothing.'
  return 'Speaker: could not play the beep. Pick another speaker, then test again.'
}

function micMessage(status: MicStatus): string {
  if (status === 'idle') return 'Microphone: not tested yet.'
  if (status === 'listening') return 'Microphone: listening. Say a few words.'
  if (status === 'heard') return 'Microphone: your voice registered.'
  if (status === 'silent') {
    return 'Microphone: nothing came through. Pick another one, then test again.'
  }
  return 'Microphone: the test failed. Pick another one, then test again.'
}

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

function DevicePicker({
  id,
  label,
  devices,
  value,
  onChange,
  disabled,
  note,
}: {
  id: string
  label: string
  devices: AudioDevice[]
  value: string | null
  onChange: (next: string) => void
  disabled: boolean
  note: string
}) {
  // Radix rejects an empty value, and the browser hands back empty ids before
  // the page holds permission, so those entries never reach the list.
  const usable = devices.filter((device) => device.deviceId.length > 0)
  const isDisabled = disabled || usable.length === 0

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? undefined} onValueChange={onChange} disabled={isDisabled}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue placeholder={`No ${label.toLowerCase()} available`} />
        </SelectTrigger>
        <SelectContent>
          {usable.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {deviceLabel(device, index, label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isDisabled && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** The bar is a second signal, never the only one — the percentage reads too. */
function LevelMeter({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent`}
        className="h-2 w-40 overflow-hidden rounded-md border border-border bg-muted"
      >
        <div
          className="h-full bg-status-success transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  )
}

function ResultLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <span className="flex h-4 shrink-0 items-center">{icon}</span>
      {text}
    </p>
  )
}
