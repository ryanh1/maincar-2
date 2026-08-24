import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CalendarAttendeeResponse, CalendarEvent, CalendarRecurrenceScope, CalendarSource } from '@/lib/calendarTypes'

const RESPONSE_LABELS: Record<CalendarAttendeeResponse, string> = {
  'needs-action': 'Needs response',
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Maybe',
}

interface ScopeSelectProps {
  label: string
  source: CalendarSource | undefined
  value: CalendarRecurrenceScope
  onValueChange: (scope: CalendarRecurrenceScope) => void
}

export function CalendarWorkspace_RecurrenceScopeSelect({ label, source, value, onValueChange }: ScopeSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(scope) => onValueChange(scope as CalendarRecurrenceScope)}>
        <SelectTrigger className="h-8 w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="this-event">This event</SelectItem>
          <SelectItem value="this-and-following" disabled={!source?.recurrenceScopes.includes('this-and-following')}>This and following</SelectItem>
          <SelectItem value="series">All events</SelectItem>
        </SelectContent>
      </Select>
      {!source?.recurrenceScopes.includes('this-and-following') ? <p className="text-xs text-text-muted">This provider can change one event or the full series.</p> : null}
    </div>
  )
}

interface EventCollaborationProps {
  event: CalendarEvent
  source: CalendarSource | undefined
  userEmail: string | null | undefined
  busy: boolean
  responseScope: CalendarRecurrenceScope
  onResponseScopeChange: (scope: CalendarRecurrenceScope) => void
  onRespond: (response: Exclude<CalendarAttendeeResponse, 'needs-action'>) => void
}

export function CalendarWorkspace_EventCollaboration({
  event,
  source,
  userEmail,
  busy,
  responseScope,
  onResponseScopeChange,
  onRespond,
}: EventCollaborationProps) {
  const ownAttendee = event.attendees.find((attendee) => attendee.email.toLowerCase() === userEmail?.toLowerCase())
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3" aria-labelledby="calendar-event-guests-heading">
      <h2 id="calendar-event-guests-heading" className="text-sm font-semibold">Guests</h2>
      {event.attendees.length ? event.attendees.map((attendee) => (
        <div key={attendee.email} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate">{attendee.name || attendee.email}</span>
          <span className="shrink-0 text-xs text-text-muted">{RESPONSE_LABELS[attendee.response]}</span>
          {attendee.name ? <span className="sr-only">{attendee.email}</span> : null}
        </div>
      )) : <p className="text-xs text-text-muted">No guests are invited.</p>}
      {ownAttendee && source?.capabilities.rsvp ? (
        <div className="mt-1 flex flex-col gap-2">
          {event.recurrenceKind === 'series' ? <CalendarWorkspace_RecurrenceScopeSelect label="Apply response to" source={source} value={responseScope} onValueChange={onResponseScopeChange} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onRespond('accepted')}>Accept</Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onRespond('tentative')}>Maybe</Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onRespond('declined')}>Decline</Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
