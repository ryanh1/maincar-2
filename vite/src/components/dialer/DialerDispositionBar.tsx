import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleDot } from 'lucide-react'
import { DynamicIcon, dynamicIconImports } from 'lucide-react/dynamic'
import type { IconName } from 'lucide-react/dynamic'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
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

export interface CallDispositionSelectedEvent {
  callId: string
  dispositionId: string
}

export interface DialerDispositionBarProps {
  orgId: string
  callId: string
  /** A terminal provider outcome that has a deterministic disposition. */
  terminalStatus?: AutoDispositionStatus | null
  /** The selected outcome stays local until Save & Next persists the full post-call action. */
  onSelect?: (event: CallDispositionSelectedEvent) => void
  /** @deprecated Pass onSelect to defer persistence to the atomic post-call action. */
  onComplete?: (event: CallDispositionSelectedEvent) => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function iconName(icon: string | null): string | null {
  if (!icon?.trim()) return null
  return icon.trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

function DispositionVisual({ disposition }: { disposition: Disposition }) {
  const configuredName = iconName(disposition.icon)
  const iconProps = {
    'aria-hidden': true,
    'data-icon-name': configuredName ?? 'circle-dot',
    'data-testid': `disposition-icon-${disposition.id}`,
    size: 16,
  }

  return (
    <>
      <span
        aria-label={`${disposition.label} color`}
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--${disposition.color})` }}
      />
      {configuredName && configuredName in dynamicIconImports ? (
        <DynamicIcon name={configuredName as IconName} fallback={() => <CircleDot {...iconProps} />} {...iconProps} />
      ) : (
        <CircleDot {...iconProps} />
      )}
    </>
  )
}

export function DialerDispositionBar({ orgId, callId, terminalStatus = null, onSelect, onComplete }: DialerDispositionBarProps) {
  const dispositionsQuery = useGetDispositions(orgId)
  const logDisposition = useLogCallDisposition(orgId, callId)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const autoHandledRef = useRef<AutoDispositionStatus | null>(null)

  const { pinned, unpinned } = useMemo(() => {
    const all = dispositionsQuery.data?.dispositions ?? []
    return {
      pinned: all.filter((disposition) => disposition.isPinned).sort((a, b) => (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity)).slice(0, 7),
      unpinned: all.filter((disposition) => !disposition.isPinned),
    }
  }, [dispositionsQuery.data?.dispositions])

  const select = useCallback(async (disposition: Disposition) => {
    setPaletteOpen(false)
    if (onSelect) {
      onSelect({ callId, dispositionId: disposition.id })
      return
    }
    if (isSaving || logDisposition.isPending) return
    setIsSaving(true)
    try {
      await logDisposition.mutateAsync({ dispositionId: disposition.id })
      onComplete?.({ callId, dispositionId: disposition.id })
    } catch {
      toast.error('Could not save the call outcome. Try again.')
    } finally {
      setIsSaving(false)
    }
  }, [callId, isSaving, logDisposition, onComplete, onSelect])

  useEffect(() => {
    if (!terminalStatus || autoHandledRef.current === terminalStatus) return
    const disposition = (dispositionsQuery.data?.dispositions ?? []).find(
      (candidate) => candidate.value === TERMINAL_DISPOSITION_VALUE[terminalStatus],
    )
    if (!disposition) return

    autoHandledRef.current = terminalStatus
    queueMicrotask(() => void select(disposition))
  }, [dispositionsQuery.data?.dispositions, select, terminalStatus])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return
      if (event.key === '0' && unpinned.length > 0) {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }

      const shortcut = Number(event.key)
      if (!Number.isInteger(shortcut) || shortcut < 1 || shortcut > pinned.length) return

      event.preventDefault()
      void select(pinned[shortcut - 1])
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pinned, select, unpinned.length])

  if (dispositionsQuery.isPending || !dispositionsQuery.data?.dispositions.length) return null

  return (
    <div className="border-t border-border pt-3" role="group" aria-label="Call outcomes">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max flex-nowrap gap-2">
          {pinned.map((disposition, index) => (
            <Button
              key={disposition.id}
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`${index + 1}: ${disposition.label}`}
              disabled={isSaving || logDisposition.isPending}
              onClick={() => void select(disposition)}
            >
              <span aria-hidden="true" className="tabular-nums text-text-muted">{index + 1}</span>
              <DispositionVisual disposition={disposition} />
              {disposition.label}
            </Button>
          ))}
          {unpinned.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="More call outcomes"
              disabled={isSaving || logDisposition.isPending}
              onClick={() => setPaletteOpen(true)}
            >
              <span aria-hidden="true" className="tabular-nums text-text-muted">0</span>
              More
            </Button>
          ) : null}
        </div>
      </div>
      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="More call outcomes"
        description="Search and choose an outcome for this call."
      >
        <CommandInput aria-label="Search call outcomes" placeholder="Search call outcomes" />
        <CommandList>
          <CommandEmpty>No matching outcomes.</CommandEmpty>
          <CommandGroup heading="More outcomes">
            {unpinned.map((disposition) => (
              <CommandItem
                key={disposition.id}
                value={disposition.label}
                disabled={isSaving || logDisposition.isPending}
                onSelect={() => void select(disposition)}
              >
                <DispositionVisual disposition={disposition} />
                {disposition.label}
                <CommandShortcut>Enter</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}
