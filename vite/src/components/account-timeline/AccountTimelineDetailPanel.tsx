import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { AccountTimelineDetail } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'
import { AccountTimelineDetailPanel_Body } from './AccountTimelineDetailPanel_Body'

export type AccountTimelineDetailState = 'loading' | 'ready' | 'error'

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || target.getAttribute('role') === 'textbox'
    || Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
  )
}

function detailLabel(detail: AccountTimelineDetail | null): string {
  if (!detail) return 'Activity detail'
  const labels: Record<AccountTimelineDetail['type'], string> = {
    call: 'Call',
    email: 'Email',
    sms: 'Text conversation',
    meeting: 'Meeting',
    note: 'Note',
    task: 'Task',
    stage_change: 'Stage change',
    record_created: 'Record created',
    custom: 'Activity',
  }
  return labels[detail.type]
}

export function AccountTimelineDetailPanel({
  open,
  onOpenChange,
  orgId,
  timeZone,
  detail,
  state = detail ? 'ready' : 'loading',
  navigation,
  onNavigate,
  onRetry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId?: string | null
  timeZone?: string | null
  detail: AccountTimelineDetail | null
  state?: AccountTimelineDetailState
  navigation: { previousEventId: string | null; nextEventId: string | null } | null
  onNavigate: (eventId: string) => void
  onRetry?: () => void
}) {
  const label = detailLabel(detail)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[540px]"
        onEscapeKeyDown={(event) => {
          if (isEditableTarget(event.target)) event.preventDefault()
        }}
        onKeyDown={(keyboardEvent) => {
          if (
            keyboardEvent.defaultPrevented
            || isEditableTarget(keyboardEvent.target)
            || keyboardEvent.ctrlKey
            || keyboardEvent.metaKey
            || keyboardEvent.altKey
          ) return
          const key = keyboardEvent.key.toLowerCase()
          const eventId = key === 'k'
            ? navigation?.previousEventId
            : key === 'j'
              ? navigation?.nextEventId
              : null
          if (!eventId) return
          keyboardEvent.preventDefault()
          onNavigate(eventId)
        }}
      >
        <SheetHeader className="border-b border-border pr-12">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <SheetTitle className="text-base">{label}</SheetTitle>
              <SheetDescription>
                {detail?.occurredAt ? formatDateTime(detail.occurredAt, timeZone) : state === 'error' ? 'This source is unavailable.' : 'Loading activity detail…'}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 gap-1">
              <IconButton tooltip="Show the previous timeline event" disabled={!navigation?.previousEventId} onClick={() => navigation?.previousEventId && onNavigate(navigation.previousEventId)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </IconButton>
              <IconButton tooltip="Show the next timeline event" disabled={!navigation?.nextEventId} onClick={() => navigation?.nextEventId && onNavigate(navigation.nextEventId)}>
                <ChevronRight size={16} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state === 'loading' && <p className="text-sm text-text-muted">Loading activity detail…</p>}
          {state === 'error' && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-danger">This activity source is missing or no longer available.</p>
              {onRetry && <Button type="button" size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
            </div>
          )}
          {state === 'ready' && detail && <AccountTimelineDetailPanel_Body detail={detail} orgId={orgId} timeZone={timeZone} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
