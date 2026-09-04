import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetCalendarAvailability } from '@/hooks/calendar'
import type { CalendarSource } from '@/lib/calendarTypes'
import { formatTime, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'
import { calendarRepeatPresets, recurrenceSummary, type CalendarRepeatMode } from './calendarRecurrence'

export type { CalendarRepeatMode } from './calendarRecurrence'

interface SchedulingFieldsProps {
  orgId: string | null | undefined
  source: CalendarSource | undefined
  date: Date
  timeZone: string
  durationMinutes: number
  guestEmails: string
  repeatMode: CalendarRepeatMode
  recurrenceRule: string
  repeatError?: string
  onGuestEmailsChange: (guestEmails: string) => void
  onRepeatChange: (repeatMode: CalendarRepeatMode, recurrenceRule: string) => void
  onRecurrenceRuleChange: (recurrenceRule: string) => void
  onChooseTime: (startTime: string) => void
}

export function CalendarWorkspace_SchedulingFields({
  orgId,
  source,
  date,
  timeZone,
  durationMinutes,
  guestEmails,
  repeatMode,
  recurrenceRule,
  repeatError,
  onGuestEmailsChange,
  onRepeatChange,
  onRecurrenceRuleChange,
  onChooseTime,
}: SchedulingFieldsProps) {
  const [showAvailability, setShowAvailability] = useState(false)
  const window = useMemo(() => {
    const startsAt = zonedDateTimeToIso(date, '09:00', timeZone)
    const endsAt = zonedDateTimeToIso(date, '17:00', timeZone)
    return startsAt && endsAt ? { startsAt, endsAt } : null
  }, [date, timeZone])
  const canLoadAvailability = source?.capabilities.availability === true
  const availability = useGetCalendarAvailability(
    orgId,
    source?.id,
    showAvailability && canLoadAvailability ? window : null,
  )
  const suggestions = useMemo(() => {
    if (!window || availability.data?.availability.state !== 'available') return []
    const busy = availability.data.availability.busy
    const durationMs = Math.max(15, durationMinutes) * 60_000
    const results: string[] = []
    for (let startsAt = new Date(window.startsAt).getTime(); startsAt + durationMs <= new Date(window.endsAt).getTime(); startsAt += 30 * 60_000) {
      const endsAt = startsAt + durationMs
      if (busy.every((interval) => endsAt <= new Date(interval.startsAt).getTime() || startsAt >= new Date(interval.endsAt).getTime())) {
        results.push(new Date(startsAt).toISOString())
      }
      if (results.length === 6) break
    }
    return results
  }, [availability.data, durationMinutes, window])
  const fallback = source?.provider === 'microsoft'
    ? 'Availability is not available for this connected Microsoft account. Choose a time manually.'
    : 'Availability is not available for this connected Google account. Choose a time manually.'
  const repeatPresets = useMemo(() => calendarRepeatPresets(date), [date])
  const repeatSummary = repeatMode === 'none'
    ? 'Does not repeat'
    : repeatMode === 'custom' && !recurrenceRule
      ? 'Custom'
      : recurrenceSummary(recurrenceRule)
  const canEditRepeat = source?.capabilities.recurrence === true
    && (source.accessRole === 'owner' || source.accessRole === 'writer')

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="calendar-event-guests">Guests</Label>
        <Input
          id="calendar-event-guests"
          className="h-8"
          value={guestEmails}
          onChange={(input) => onGuestEmailsChange(input.target.value)}
          placeholder="guest@example.com, teammate@example.com"
        />
        <p className="text-xs text-text-muted">Separate guest email addresses with commas.</p>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Repeat</Label>
        {canEditRepeat ? (
          <Select
            value={repeatMode === 'custom' && recurrenceRule ? 'custom-existing' : repeatMode}
            onValueChange={(next) => {
              const preset = repeatPresets.find((candidate) => candidate.id === next)
              if (preset) onRepeatChange(preset.id, preset.recurrenceRule ?? recurrenceRule)
            }}
          >
            <SelectTrigger
              className="min-h-8 h-auto w-full whitespace-normal py-1 text-left text-[13px] *:data-[slot=select-value]:line-clamp-none"
              aria-label={repeatSummary}
              aria-haspopup="listbox"
              aria-invalid={!!repeatError}
            >
              <SelectValue>{repeatSummary}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {repeatPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <span className="flex flex-col items-start">
                    <span>{preset.label}</span>
                    {preset.note ? <span className="text-xs text-text-muted">{preset.note}</span> : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="min-h-8 rounded-md border border-border bg-surface px-3 py-1 text-[13px]">{repeatSummary}</div>
        )}
        {!source?.capabilities.recurrence ? <p className="text-xs text-text-muted">This connected calendar cannot create recurring events.</p> : null}
        {source && source.capabilities.recurrence && !canEditRepeat ? <p className="text-xs text-text-muted">This calendar cannot be edited here.</p> : null}
        {repeatError ? <p className="text-xs text-danger" role="alert">{repeatError}</p> : null}
      </div>
      {repeatMode === 'custom' ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="calendar-event-recurrence-rule">Provider recurrence rule</Label>
          <Input id="calendar-event-recurrence-rule" className="h-8" value={recurrenceRule} onChange={(input) => onRecurrenceRuleChange(input.target.value)} placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO,WE" />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Find a time</p>
            <p className="text-xs text-text-muted">Check the selected calendar from 9:00 AM to 5:00 PM.</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowAvailability(true)}>Find a time</Button>
        </div>
        {showAvailability && !canLoadAvailability ? <p className="text-xs text-text-muted" role="status">{fallback}</p> : null}
        {showAvailability && canLoadAvailability && availability.isLoading ? <p className="text-xs text-text-muted" role="status">Checking availability.</p> : null}
        {showAvailability && canLoadAvailability && availability.isError ? <p className="text-xs text-danger" role="status">Could not check availability. Choose a time manually.</p> : null}
        {showAvailability && canLoadAvailability && suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Available times">
            {suggestions.map((startsAt) => {
              const time = zonedDateTimeParts(startsAt, timeZone).time
              return <Button key={startsAt} type="button" variant="secondary" size="sm" onClick={() => onChooseTime(time)}>{formatTime(startsAt, timeZone)}</Button>
            })}
          </div>
        ) : null}
        {showAvailability && canLoadAvailability && availability.data?.availability.state === 'available' && suggestions.length === 0 ? <p className="text-xs text-text-muted" role="status">No open times are available that day. Choose another date.</p> : null}
      </div>
    </>
  )
}
