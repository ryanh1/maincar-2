import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetCalendarAvailability } from '@/hooks/calendar'
import type { CalendarSource } from '@/lib/calendarTypes'
import { formatTime, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'

export type CalendarRepeatMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'

interface SchedulingFieldsProps {
  orgId: string | null | undefined
  source: CalendarSource | undefined
  date: Date
  timeZone: string
  durationMinutes: number
  guestEmails: string
  repeatMode: CalendarRepeatMode
  recurrenceRule: string
  onGuestEmailsChange: (guestEmails: string) => void
  onRepeatChange: (repeatMode: CalendarRepeatMode) => void
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
        <Select value={repeatMode} onValueChange={(next) => onRepeatChange(next as CalendarRepeatMode)} disabled={!source?.capabilities.recurrence}>
          <SelectTrigger className="h-8 w-full" aria-label="Repeat event"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="custom">Custom provider rule</SelectItem>
          </SelectContent>
        </Select>
        {!source?.capabilities.recurrence ? <p className="text-xs text-text-muted">This connected calendar cannot create recurring events.</p> : null}
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
