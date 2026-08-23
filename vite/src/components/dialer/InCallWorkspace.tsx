import { useEffect, useRef, useState } from 'react'
import { Grid3X3, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { NumericKeypad } from '@/components/dialer/NumericKeypad'
import { InCallControls } from '@/components/dialer/InCallControls'
import { useDialer } from '@/components/dialer/dialerContext'
import { useGetCallDetail, useSaveCallNote } from '@/hooks/dialer'

const NOTE_SAVE_DELAY_MS = 500

export interface InCallWorkspaceProps {
  orgId: string
  callId: string
  /** Available immediately after placing a call, before detail context resolves. */
  toE164: string
  /** The linked company from the live call's response, if the number matched a person. */
  companyId?: string | null
  recording?: boolean
}

function personName(person: { firstName: string | null; lastName: string | null; preferredFirstName: string | null } | null) {
  if (!person) return null
  return person.preferredFirstName ?? ([person.firstName, person.lastName].filter(Boolean).join(' ') || null)
}

/** The live-call view: CRM context, durable notes, an on-demand DTMF keypad, and controls. */
export function InCallWorkspace({ orgId, callId, toE164, companyId, recording = false }: InCallWorkspaceProps) {
  const { phase } = useDialer()
  const detailQuery = useGetCallDetail(orgId, callId)
  const saveNote = useSaveCallNote(orgId, callId)
  const [noteText, setNoteText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const previousPhaseRef = useRef(phase)

  const call = detailQuery.data?.call
  const serverNote = call?.noteText ?? ''
  const crm = call?.review?.crm
  const name = personName(crm?.person ?? null)
  const number = call
    ? call.direction === 'inbound' ? call.fromE164 : call.toE164
    : toE164
  // A status poll updates the same cache as this workspace. Once a rep has typed,
  // their local draft remains authoritative until this call leaves the dock.
  const visibleNote = dirty ? noteText : serverNote

  useEffect(() => {
    const becameLive = previousPhaseRef.current !== 'in-progress' && phase === 'in-progress'
    previousPhaseRef.current = phase
    if (becameLive) noteRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => saveNote.mutate({ noteText }), NOTE_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, noteText, saveNote])

  return (
    <div className="flex flex-col gap-3">
      <div className="border-b border-border pb-3">
        <p className="text-sm font-medium tabular-nums">{number}</p>
        {name ? <p className="text-xs text-text-muted">{name}</p> : null}
        {crm?.company?.name ? <p className="text-xs text-text-muted">{crm.company.name}</p> : null}
      </div>

      <div className="relative min-h-32">
        <label htmlFor={`call-note-${callId}`} className="mb-1 block text-xs font-medium text-text-muted">Call notes</label>
        <Textarea
          ref={noteRef}
          id={`call-note-${callId}`}
          aria-label="Call notes"
          className="min-h-24 text-sm"
          placeholder="Add notes"
          value={visibleNote}
          onChange={(event) => {
            setDirty(true)
            setNoteText(event.target.value)
          }}
        />
        {keypadOpen ? (
          <div className="absolute inset-0 z-10 border border-border bg-card p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Keypad</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => setKeypadOpen(false)}>
                <X size={16} aria-hidden="true" />
                Close keypad
              </Button>
            </div>
            <NumericKeypad />
          </div>
        ) : (
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setKeypadOpen(true)}>
            <Grid3X3 size={16} aria-hidden="true" />
            Open keypad
          </Button>
        )}
      </div>

      <InCallControls
        orgId={orgId}
        callId={callId}
        companyId={companyId}
        companyName={crm?.company?.name ?? null}
        recording={recording}
      />
    </div>
  )
}
