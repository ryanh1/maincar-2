import { useEffect, useState } from 'react'
import { ChevronDown, Phone } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { formatElapsed } from '@/lib/duration'
import { InCallWorkspace } from '@/components/dialer/InCallWorkspace'
import { DialerDispositionBar } from '@/components/dialer/DialerDispositionBar'
import { DialerPostCallActions } from '@/components/dialer/DialerPostCallActions'
import { NumericKeypad } from '@/components/dialer/NumericKeypad'
import { Button } from '@/components/ui/button'
import { useDialer } from '@/components/dialer/dialerContext'
import { useOutreachLayout } from '@/components/outreachLayout'
import { useGetCallDetail } from '@/hooks/dialer'
import { formatDateTime } from '@/lib/datetime'
import { useAuth } from '@/providers/useAuth'

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
  const { user } = useAuth()
  const {
    view, mode, phase, elapsedSeconds, activeCall, terminalStatus, prefilledNumber,
    toggleView, collapseDialer, acceptIncomingCall, rejectIncomingCall,
    reset,
  } = useDialer()
  const [postCall, setPostCall] = useState<{ callId: string; dispositionId: string } | null>(null)
  const [draftNote, setDraftNote] = useState<{ callId: string; noteText: string } | null>(null)
  const outreachLayout = useOutreachLayout()
  const expanded = view === 'expanded'
  const inCall = mode === 'call'
  const incoming = phase === 'ringing' && activeCall?.direction === 'inbound'
  const detailQuery = useGetCallDetail(
    incoming ? activeCall?.orgId : null,
    incoming ? activeCall?.callId : null,
  )
  const caller = incoming ? detailQuery.data?.call.review?.crm.person : null
  const account = incoming ? detailQuery.data?.call.review?.crm.company : null
  const callerName = caller
    ? caller.preferredFirstName ?? ([caller.firstName, caller.lastName].filter(Boolean).join(' ') || null)
    : null
  const persona = caller?.persona ? caller.persona.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : null
  const selectedDispositionId = postCall && postCall.callId === activeCall?.callId ? postCall.dispositionId : null
  const draftNoteText = draftNote && draftNote.callId === activeCall?.callId ? draftNote.noteText : ''

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
      className={cn(
        'fixed bottom-0 flex flex-col bg-card text-card-foreground',
        outreachLayout.usesRail
          ? 'z-[100] w-80 rounded-t-md border border-b-0 border-border shadow-md'
          : 'inset-x-0 top-0 z-[130] w-full overflow-y-auto',
      )}
      style={outreachLayout.usesRail ? { right: outreachLayout.dialerRightInsetPx } : undefined}
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
        {incoming && activeCall ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs text-text-muted">Incoming call</p>
              <p className="text-sm font-medium tabular-nums">{activeCall.toE164}</p>
              {caller && callerName ? (
                <div className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
                  <Link to={`/records/person/${caller.id}`} className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline">
                    Open {callerName}
                  </Link>
                  {account?.name ? <p>{account.name}</p> : null}
                  {persona ? <p>{persona}</p> : null}
                  {caller.lastContactedAt ? <p>Last touch {formatDateTime(caller.lastContactedAt, user?.timeZone)}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="success" className="flex-1" onClick={acceptIncomingCall}>
                Accept call
              </Button>
              <Button type="button" size="sm" variant="outline" className="flex-1" onClick={rejectIncomingCall}>
                Reject call
              </Button>
            </div>
          </div>
        ) : inCall && activeCall ? (
          <InCallWorkspace
            key={activeCall.callId}
            orgId={activeCall.orgId}
            callId={activeCall.callId}
            toE164={activeCall.toE164 ?? ''}
            companyId={activeCall.companyId}
            recording={activeCall.recording}
            onNoteTextChange={(noteText) => setDraftNote({ callId: activeCall.callId, noteText })}
          />
        ) : (
          <NumericKeypad initialEntry={prefilledNumber} />
        )}
        {activeCall && !selectedDispositionId ? (
          <DialerDispositionBar
            orgId={activeCall.orgId}
            callId={activeCall.callId}
            terminalStatus={terminalStatus}
            onSelect={({ dispositionId }) => setPostCall({ callId: activeCall.callId, dispositionId })}
          />
        ) : null}
        {activeCall && selectedDispositionId ? (
          <DialerPostCallActions
            orgId={activeCall.orgId}
            callId={activeCall.callId}
            dispositionId={selectedDispositionId}
            noteText={draftNoteText}
            onSaved={reset}
          />
        ) : null}
      </div>
    </div>
  )
}
