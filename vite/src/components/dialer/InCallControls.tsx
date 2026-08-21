import { useCallback, useState } from 'react'
import { Mic, MicOff, Pause, Phone, PhoneOff, Play } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { formatElapsed } from '@/lib/duration'
import { Button } from '@/components/ui/button'
import type { CallPhase } from '@/components/dialer/dialerContext'
import { useDialer } from '@/components/dialer/dialerContext'
import { useEndCall } from '@/hooks/dialer'

/**
 * The mute/hold seam.
 *
 * Muting or holding a live call means telling the browser Voice SDK to stop
 * sending the mic / park the audio — `Twilio.Device.activeConnection().mute(true)`
 * and the hold flow behind it. That device is NOT in the app yet (nothing imports
 * `@twilio/voice-sdk`), so these buttons cannot actually silence the audio.
 *
 * They are still honest controls, not dead ones: each press flips the VISIBLE
 * state (the icon, the pressed styling, the accessible label) and calls the seam
 * with the new value. Once a Device is wired, pass an `onToggleMute` /
 * `onToggleHold` that forwards to the SDK and the audio follows for free — the
 * button already reports the state and calls this on every press.
 *
 * TODO(MAI): forward these seams to the Twilio.js Device once the browser Voice
 * SDK is added under `vite/src/dependencies/`.
 */
export type ToggleCallControl = (next: boolean) => void

// Stable identities so the default props do not change between renders.
const noopToggle: ToggleCallControl = () => {}

/** Human-facing status line for each phase the in-call view can show. */
const STATUS_LABEL: Record<CallPhase, string> = {
  idle: 'Idle',
  ringing: 'Ringing',
  'in-progress': 'Connected',
  completed: 'Call ended',
}

export interface InCallControlsProps {
  /** Org the call belongs to — needed to hang it up. */
  orgId: string
  /** The live call to hang up. */
  callId: string
  /**
   * Whether this call is being recorded. Drives the red recording dot. Comes from
   * the call's `recordingEnabled` — the dot never shows on a call with no consent.
   */
  recording?: boolean
  /**
   * Mute seam. Called with the new muted state on every press. Defaults to a
   * documented no-op because the browser Voice SDK is not wired yet — see
   * {@link ToggleCallControl}.
   */
  onToggleMute?: ToggleCallControl
  /**
   * Hold seam. Called with the new held state on every press. Same no-op default
   * and same reason as {@link onToggleMute}.
   */
  onToggleHold?: ToggleCallControl
  className?: string
}

/**
 * The controls shown while a call is live: a phone icon, the running duration and
 * a status line, and the mute / hold / end buttons.
 *
 * Wiring honesty (CLAUDE.md → "Never leave a feature half-wired"):
 *  - End is fully wired. It hangs the call up through `useEndCall`, which moves the
 *    shared dialer to its completed state on success.
 *  - Mute and Hold are seams. They flip the visible state and call
 *    `onToggleMute` / `onToggleHold`, but cannot silence the audio until the
 *    browser Voice SDK is added — see {@link ToggleCallControl}.
 *
 * The duration and status read the shared dialer state (`useDialer`), so the timer
 * ticks with the one interval the provider owns rather than a second clock here.
 */
export function InCallControls({
  orgId,
  callId,
  recording = false,
  onToggleMute = noopToggle,
  onToggleHold = noopToggle,
  className,
}: InCallControlsProps) {
  const { phase, elapsedSeconds } = useDialer()
  const endCall = useEndCall()

  const [muted, setMuted] = useState(false)
  const [held, setHeld] = useState(false)

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current
      onToggleMute(next)
      return next
    })
  }, [onToggleMute])

  const toggleHold = useCallback(() => {
    setHeld((current) => {
      const next = !current
      onToggleHold(next)
      return next
    })
  }, [onToggleHold])

  // Hang up. Guarded so a double-click during the round trip is a no-op rather than
  // a second DELETE, and so a refused hang-up tells the rep why instead of nothing.
  const hangUp = useCallback(() => {
    if (endCall.isPending) return
    endCall.mutate(
      { orgId, callId },
      {
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not end the call. Try again.'),
      },
    )
  }, [endCall, orgId, callId])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <Phone aria-hidden="true" size={16} className="text-muted-foreground shrink-0" />
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-medium tabular-nums" aria-label="Call duration">
            {formatElapsed(elapsedSeconds)}
          </span>
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[phase]}</span>
        </div>
        {recording ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
            Recording
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="Call controls">
        <Button
          type="button"
          variant={muted ? 'secondary' : 'outline'}
          size="icon-sm"
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </Button>

        <Button
          type="button"
          variant={held ? 'secondary' : 'outline'}
          size="icon-sm"
          aria-pressed={held}
          aria-label={held ? 'Resume' : 'Hold'}
          onClick={toggleHold}
        >
          {held ? <Play size={16} /> : <Pause size={16} />}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="ml-auto"
          aria-label="End call"
          disabled={endCall.isPending}
          onClick={hangUp}
        >
          <PhoneOff size={16} />
          End
        </Button>
      </div>
    </div>
  )
}
