import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLogCallDisposition } from '@/hooks/dialer'
import { useGetDispositions } from '@/hooks/dispositions'
import type { CallStatus } from '@/lib/callTypes'
import type { Disposition } from '@/lib/dispositionTypes'

type AutoDispositionStatus = Extract<CallStatus, 'no-answer' | 'busy' | 'failed'>

/** Stable disposition values, deliberately independent of each organization's editable labels. */
const TERMINAL_DISPOSITION_VALUE: Record<AutoDispositionStatus, string> = {
  'no-answer': 'no_answer',
  busy: 'busy',
  // A technical dial failure has no separate seeded business outcome, so it uses
  // the organization-configured no-answer disposition. Reps can still change it
  // from call history.
  failed: 'no_answer',
}

export interface CallDispositionCompletedEvent {
  callId: string
  dispositionId: string
}

export interface DialerDispositionBarProps {
  orgId: string
  callId: string
  /** A terminal provider outcome that has a deterministic disposition. */
  terminalStatus?: AutoDispositionStatus | null
  /** Consumption seam for a later power-dial session. Fires only after persistence. */
  onComplete?: (event: CallDispositionCompletedEvent) => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function DialerDispositionBar({ orgId, callId, terminalStatus = null, onComplete }: DialerDispositionBarProps) {
  const dispositionsQuery = useGetDispositions(orgId)
  const logDisposition = useLogCallDisposition(orgId, callId)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const autoHandledRef = useRef<AutoDispositionStatus | null>(null)

  const { pinned, unpinned } = useMemo(() => {
    const all = dispositionsQuery.data?.dispositions ?? []
    return {
      pinned: all.filter((disposition) => disposition.isPinned).sort((a, b) => (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity)).slice(0, 7),
      unpinned: all.filter((disposition) => !disposition.isPinned),
    }
  }, [dispositionsQuery.data?.dispositions])

  const save = useCallback(async (disposition: Disposition) => {
    if (savingRef.current || saved) return

    savingRef.current = true
    setIsSaving(true)
    try {
      await logDisposition.mutateAsync({ dispositionId: disposition.id })
      setSaved(true)
      onComplete?.({ callId, dispositionId: disposition.id })
    } catch {
      toast.error('Could not save the call outcome. Try again.')
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [callId, logDisposition, onComplete, saved])

  useEffect(() => {
    if (!terminalStatus || autoHandledRef.current === terminalStatus) return
    const disposition = (dispositionsQuery.data?.dispositions ?? []).find(
      (candidate) => candidate.value === TERMINAL_DISPOSITION_VALUE[terminalStatus],
    )
    if (!disposition) return

    autoHandledRef.current = terminalStatus
    queueMicrotask(() => void save(disposition))
  }, [dispositionsQuery.data?.dispositions, save, terminalStatus])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return
      const shortcut = Number(event.key)
      if (!Number.isInteger(shortcut) || shortcut < 1 || shortcut > pinned.length) return

      event.preventDefault()
      void save(pinned[shortcut - 1])
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pinned, save])

  if (saved || dispositionsQuery.isPending || !dispositionsQuery.data?.dispositions.length) return null

  return (
    <div className="border-t border-border pt-3" role="group" aria-label="Call outcomes">
      <div className="flex flex-wrap gap-2">
        {pinned.map((disposition, index) => (
          <Button
            key={disposition.id}
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`${index + 1}: ${disposition.label}`}
            disabled={isSaving || logDisposition.isPending}
            onClick={() => void save(disposition)}
          >
            <span aria-hidden="true" className="tabular-nums text-text-muted">{index + 1}</span>
            {disposition.label}
          </Button>
        ))}
        {unpinned.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="secondary" aria-label="More call outcomes" disabled={isSaving || logDisposition.isPending}>
                More <ChevronDown size={16} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {unpinned.map((disposition) => (
                <DropdownMenuItem key={disposition.id} onSelect={() => void save(disposition)}>
                  {disposition.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
