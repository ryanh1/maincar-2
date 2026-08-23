import { useState } from 'react'
import { CalendarClock, ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useCompleteCall } from '@/hooks/dialer'
import { useGetDispositionNextStepRules, useGetNextStepTypes } from '@/hooks/nextSteps'
import { formatDateTime, formatTimeZoneName, zonedDateTimeToIso } from '@/lib/datetime'
import type { NextStepType } from '@/lib/nextStepTypes'
import { useAuth } from '@/providers/useAuth'

type SelectedNextStep = { nextStepTypeId: string; scheduledAt?: string | null }

export interface DialerPostCallActionsProps {
  orgId: string
  callId: string
  dispositionId: string
  noteText: string
  onSaved: () => void
}

/** The optional second row of the post-call loop, saved atomically with the outcome. */
export function DialerPostCallActions({ orgId, callId, dispositionId, noteText, onSaved }: DialerPostCallActionsProps) {
  const { user } = useAuth()
  const typesQuery = useGetNextStepTypes(orgId)
  const rulesQuery = useGetDispositionNextStepRules(orgId)
  const completeCall = useCompleteCall(orgId, callId)
  const [chosen, setChosen] = useState<SelectedNextStep[]>([])
  const [removedSuggestedId, setRemovedSuggestedId] = useState<string | null>(null)
  const [dateTimeType, setDateTimeType] = useState<NextStepType | null>(null)
  const [callbackDate, setCallbackDate] = useState<Date | undefined>()
  const [callbackTime, setCallbackTime] = useState('09:00')
  const timeZone = user?.timeZone
  const timeZoneName = formatTimeZoneName(callbackDate ?? new Date(), timeZone)
  const types = typesQuery.data?.types ?? []
  const pinnedTypes = types.filter((type) => type.isPinned)
  const overflowTypes = types.filter((type) => !type.isPinned)

  const suggested = rulesQuery.data?.rules.find((rule) => rule.dispositionId === dispositionId)?.nextStepType
  const suggestedSelection: SelectedNextStep | null = suggested && types.some((type) => type.id === suggested.id) && removedSuggestedId !== suggested.id
    ? { nextStepTypeId: suggested.id }
    : null
  const selected = suggestedSelection && !chosen.some((nextStep) => nextStep.nextStepTypeId === suggestedSelection.nextStepTypeId)
    ? [suggestedSelection, ...chosen]
    : chosen

  function remove(typeId: string) {
    if (suggestedSelection?.nextStepTypeId === typeId) setRemovedSuggestedId(typeId)
    setChosen((current) => current.filter((nextStep) => nextStep.nextStepTypeId !== typeId))
  }

  function choose(type: NextStepType) {
    if (selected.some((nextStep) => nextStep.nextStepTypeId === type.id)) {
      remove(type.id)
      return
    }
    if (type.requiresDateTime) {
      setDateTimeType(type)
      return
    }
    setChosen((current) => [...current, { nextStepTypeId: type.id }])
  }

  function addTimedStep() {
    if (!dateTimeType || !callbackDate) return
    const scheduledAt = zonedDateTimeToIso(callbackDate, callbackTime, timeZone)
    if (!scheduledAt) return
    setChosen((current) => [...current, { nextStepTypeId: dateTimeType.id, scheduledAt }])
    setDateTimeType(null)
  }

  async function save() {
    try {
      await completeCall.mutateAsync({ dispositionId, noteText: noteText || null, nextSteps: selected })
      onSaved()
    } catch {
      toast.error('Could not save the call. Check your connection and try again.')
    }
  }

  const selectedTypes = selected.flatMap((nextStep) => {
    const type = types.find((candidate) => candidate.id === nextStep.nextStepTypeId)
    return type ? [{ nextStep, type }] : []
  })

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Next steps">
      <div className="flex flex-wrap gap-2">
        {pinnedTypes.map((type) => (
          <Button key={type.id} type="button" size="sm" variant="secondary" onClick={() => choose(type)} disabled={completeCall.isPending}>
            {type.label}
          </Button>
        ))}
        {overflowTypes.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="secondary" disabled={completeCall.isPending}>
                More
                <ChevronDown size={16} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {overflowTypes.map((type) => (
                <DropdownMenuItem key={type.id} onSelect={() => choose(type)}>{type.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {selectedTypes.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected next steps">
          {selectedTypes.map(({ nextStep, type }) => (
            <Button key={type.id} type="button" size="sm" variant="outline" aria-label={`Remove ${type.label}`} onClick={() => remove(type.id)} disabled={completeCall.isPending}>
              {nextStep.scheduledAt ? `${type.label}: ${formatDateTime(nextStep.scheduledAt, timeZone)}` : type.label}
              <X size={16} aria-hidden="true" />
            </Button>
          ))}
        </div>
      ) : null}
      <Button type="button" size="sm" onClick={() => void save()} disabled={completeCall.isPending}>
        Save & Next
      </Button>

      <Dialog open={dateTimeType !== null} onOpenChange={(open) => { if (!open) setDateTimeType(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dateTimeType?.label}</DialogTitle>
            <DialogDescription>Choose when the rep should call back.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <DatePicker value={callbackDate} onChange={setCallbackDate} ariaLabel="Callback date" />
            <div>
              <label htmlFor="callback-time" className="mb-1 block text-xs font-medium text-text-muted">Time ({timeZoneName})</label>
              <Input id="callback-time" type="time" value={callbackTime} onChange={(event) => setCallbackTime(event.target.value)} />
            </div>
            {callbackDate ? <p className="text-xs text-text-muted"><CalendarClock size={14} aria-hidden="true" className="mr-1 inline" />{formatDateTime(zonedDateTimeToIso(callbackDate, callbackTime, timeZone) ?? '', timeZone)}</p> : <p className="text-xs text-text-muted">Times use {timeZoneName}.</p>}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" onClick={() => setDateTimeType(null)}>Cancel</Button>
            <Button type="button" size="sm" disabled={!callbackDate} onClick={addTimedStep}>Add callback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
