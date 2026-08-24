import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CalendarRecurrenceScope, CalendarSource } from '@/lib/calendarTypes'
import { CalendarWorkspace_RecurrenceScopeSelect } from './CalendarWorkspace_EventCollaboration'

interface RecurringActionDialogProps {
  action: 'move' | 'resize'
  source: CalendarSource | undefined
  busy: boolean
  onCancel: () => void
  onConfirm: (scope: CalendarRecurrenceScope) => void
}

export function CalendarWorkspace_RecurringActionDialog({ action, source, busy, onCancel, onConfirm }: RecurringActionDialogProps) {
  const [scope, setScope] = useState<CalendarRecurrenceScope>('this-event')
  const actionLabel = action === 'move' ? 'Move' : 'Resize'
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{actionLabel} recurring event</DialogTitle></DialogHeader>
        <CalendarWorkspace_RecurrenceScopeSelect label="Apply change to" source={source} value={scope} onValueChange={setScope} />
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => onConfirm(scope)}>{actionLabel} events</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
