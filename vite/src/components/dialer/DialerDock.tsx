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
 * The dialer's docked surface: a panel pinned to the bottom-right corner that a
 * rep drives without leaving the page they are on.
 *
 * It renders nothing of its own state — every bit of it (open or shut, keypad or
 * in-call controls, the running duration) reads from `useDialer()`, the one place
 * a call lives. Mounted once above the router (in `ProtectedLayout`, beside the
 * composer dock) so a call in progress survives navigation between pages.
 *
 * Behavior the issue asks for:
 *  - Collapsed shows only the title bar; the call duration rides in it during a call.
 *  - Expanded shows the keypad when idle, the in-call controls while a call is up.
 *  - Clicking the title bar toggles the two. ⌘⇧D (or Ctrl+Shift+D) toggles from
 *    anywhere. Escape collapses, but never mid-call — a rep reaching for Escape
 *    during a live call must not lose the controls that hang it up.
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
      // ⌘⇧D / Ctrl+Shift+D toggles from anywhere. `code` keeps it on the physical
      // D key regardless of layout, and preventDefault keeps the browser's own
      // bookmark shortcut out of it.
      if (e.code === 'KeyD' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleView()
        return
      }
      // Escape collapses, but not while a call is live.
      if (e.key === 'Escape' && !inCall) {
        collapseDialer()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleView, collapseDialer, inCall])

  // "Start call" only while idle and collapsed — the label naming what a
  // click does. Mid-call there is nothing left to start, so the collapsed
  // button reads "Dialer" instead, same as the expanded title bar always has.
  const label = !expanded && phase === 'idle' ? 'Start call' : 'Dialer'

  return (
    <div
      role="region"
      aria-label="Dialer"
      className={cn(
        'fixed bottom-0 right-6 z-[100] flex flex-col bg-card text-card-foreground',
        // Expanded keeps the floating-card look it always had. Collapsed is
        // one flat segment in the dock's own row: no top border, no rounded
        // corners — only the side borders that separate it from its neighbor
        // (MAI-209 → edge-to-edge borders), sized to its own content instead
        // of the card's fixed width.
        expanded
          ? 'w-80 rounded-t-md border border-b-0 border-border shadow-md'
          : 'w-auto border-x border-border',
      )}
    >
      <button
        type="button"
        onClick={toggleView}
        aria-expanded={expanded}
        aria-controls={BODY_ID}
        className="flex h-8 items-center gap-2 px-3 text-left text-sm font-medium transition-colors hover:bg-accent/50"
      >
        <Phone size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        {phase !== 'idle' ? (
          <span className="text-xs tabular-nums text-muted-foreground" aria-label="Call duration">
            {formatElapsed(elapsedSeconds)}
          </span>
        ) : null}
        {expanded ? (
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        ) : null}
      </button>

      {expanded ? (
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
      ) : null}
    </div>
  )
}
