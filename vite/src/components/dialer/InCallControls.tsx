import { useCallback, useState } from 'react'
import { Mic, MicOff, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { formatElapsed } from '@/lib/duration'
import { IconButton } from '@/components/ui/icon-button'
import type { CallPhase } from '@/components/dialer/dialerContext'
import { useDialer } from '@/components/dialer/dialerContext'
import { useEndCall } from '@/hooks/dialer'

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
   * Whether this call is being recorded. Drives the red recording dot. Today this
   * is an optimistic read of consent at the moment the call was placed
   * (useCreateCall.ts), not Twilio's own confirmation — there is no live channel
   * from the recording-status webhook back to this dialer session (MAI-191). The
   * dot still never shows on a call with no consent, since consent is a
   * precondition either way.
   */
  recording?: boolean
  className?: string
}

/**
 * The controls shown while a call is live: a phone icon, the running duration and
 * a status line, and the mute / end buttons.
 *
 * Wiring honesty (CLAUDE.md → "Never leave a feature half-wired"):
 *  - End is fully wired: it hangs the call up through `useEndCall`, which moves
 *    the shared dialer to its completed state on success.
 *  - Mute is fully wired too, through `useDialer().muteCall`, which forwards
 *    straight to the live browser Voice SDK Call's `mute()` (MAI-195) — pressing
 *    it actually stops the rep's audio reaching the callee.
 *  - Hold has no button here. The Voice SDK's `Call` has no hold method; a real
 *    hold means a server-side redirect of the call to hold music, which is its
 *    own feature. Rather than ship it as a live-looking no-op, it was removed
 *    (MAI-195) until that feature exists.
 *
 * The duration and status read the shared dialer state (`useDialer`), so the timer
 * ticks with the one interval the provider owns rather than a second clock here.
 */
export function InCallControls({ orgId, callId, recording = false, className }: InCallControlsProps) {
  const { phase, elapsedSeconds, canControlAudio, muteCall } = useDialer()
  const endCall = useEndCall()

  const [muted, setMuted] = useState(false)

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current
      muteCall(next)
      return next
    })
  }, [muteCall])

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
        {canControlAudio ? (
          <IconButton
            type="button"
            variant={muted ? 'secondary' : 'outline'}
            aria-pressed={muted}
            tooltip={muted ? 'Unmute the call' : 'Mute the call'}
            onClick={toggleMute}
          >
            {muted ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
          </IconButton>
        ) : null}

        <IconButton
          type="button"
          variant="destructive"
          className="ml-auto"
          tooltip="End the call"
          disabled={endCall.isPending}
          onClick={hangUp}
        >
          <Phone size={16} aria-hidden className="rotate-[135deg]" />
        </IconButton>
      </div>
    </div>
  )
}
