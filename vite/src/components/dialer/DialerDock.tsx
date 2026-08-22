import { useEffect } from 'react'
import { ChevronDown, Phone } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatElapsed } from '@/lib/duration'
import { InCallControls } from '@/components/dialer/InCallControls'
import { NumericKeypad } from '@/components/dialer/NumericKeypad'
import { useDialer } from '@/components/dialer/dialerContext'

/** Ties the title-bar toggle to the body it opens for assistive tech. */
const BODY_ID = 'dialer-dock-body'

/**
 * The dialer's expanded surface: a panel pinned beside the command bar that a
 * rep drives without leaving the page they are on.
 *
 * It renders nothing of its own state — every bit of it (open or shut, keypad or
 * in-call controls, the running duration) reads from `useDialer()`, the one place
 * a call lives. Mounted once above the router (in `ProtectedLayout`, beside the
 * composer dock) so a call in progress survives navigation between pages.
 *
 * The command bar is the sole idle entry point. This component renders only
 * after it has been expanded; it contains the keypad while idle and in-call
 * controls while a call is up. Escape closes it while idle, but never mid-call
 * — a rep reaching for Escape during a live call must not lose the controls that
 * hang it up.
 *
 * z-100 keeps it above the composer dock (z-40), which already reserves this
 * corner's width so the two never overlap.
 */
export function DialerDock() {
  const { view, mode, phase, elapsedSeconds, activeCall, toggleView, collapseDialer } = useDialer()
  const expanded = view === 'expanded'
  const inCall = mode === 'call'

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape collapses, but not while a call is live.
      if (e.key === 'Escape' && !inCall) {
        collapseDialer()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleView, collapseDialer, inCall])

  if (!expanded) return null

  return (
    <div
      role="region"
      aria-label="Dialer"
      className={cn('fixed bottom-0 right-16 z-[100] flex w-80 flex-col rounded-t-md border border-b-0 border-border bg-card text-card-foreground shadow-md')}
    >
      <button
        type="button"
        onClick={toggleView}
        aria-expanded={expanded}
        aria-controls={BODY_ID}
        className="flex h-8 items-center gap-2 px-3 text-left text-sm font-medium transition-colors hover:bg-accent/50"
      >
        <Phone size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">Dialer</span>
        {phase !== 'idle' ? (
          <span className="text-xs tabular-nums text-muted-foreground" aria-label="Call duration">
            {formatElapsed(elapsedSeconds)}
          </span>
        ) : null}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      </button>

      <div id={BODY_ID} className="border-t border-border p-3">
        {inCall && activeCall ? (
          <InCallControls
            orgId={activeCall.orgId}
            callId={activeCall.callId}
            recording={activeCall.recording}
          />
        ) : (
          <NumericKeypad />
        )}
      </div>
    </div>
  )
}
