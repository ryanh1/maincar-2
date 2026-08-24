import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, GripHorizontal, Plus, Settings2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateCalendarEvent, useDeleteCalendarEvent, useGetCalendarEvents, useGetCalendarSources, useRespondToCalendarEvent, useUpdateCalendarEvent, useUpdateCalendarSource } from '@/hooks/calendar'
import type { CalendarAttendeeResponse, CalendarEvent, CalendarEventCreateInput, CalendarEventPatch, CalendarRecurrenceScope } from '@/lib/calendarTypes'
import { ApiError } from '@/lib/api'
import { formatDate, formatDateTime, formatTime, formatTimeZoneName, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'
import { useAuth } from '@/providers/useAuth'
import { cn } from '@/lib/utils'
import { CalendarWorkspace_EventDetails, CalendarWorkspace_EventEditor, CalendarWorkspace_QuickCreate } from './CalendarWorkspace_EventDialogs'
import { CalendarWorkspace_RecurringActionDialog } from './CalendarWorkspace_RecurringActionDialog'

type CalendarView = 'day' | 'week' | 'month' | 'agenda'

const VIEWS: Array<{ id: CalendarView; label: string }> = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'agenda', label: 'Agenda' },
]

function visibleRange(date: Date, view: CalendarView): { startsAt: Date; endsAt: Date } {
  if (view === 'day') {
    const startsAt = startOfDay(date)
    return { startsAt, endsAt: addDays(startsAt, 1) }
  }
  if (view === 'week') return { startsAt: startOfWeek(date, { weekStartsOn: 0 }), endsAt: addDays(endOfWeek(date, { weekStartsOn: 0 }), 1) }
  if (view === 'month') return { startsAt: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), endsAt: addDays(endOfWeek(endOfMonth(date), { weekStartsOn: 0 }), 1) }
  const startsAt = startOfDay(date)
  return { startsAt, endsAt: addDays(startsAt, 30) }
}

function rangeLabel(date: Date, view: CalendarView): string {
  if (view === 'day') return format(date, 'MMMM d, yyyy')
  if (view === 'month') return format(date, 'MMMM yyyy')
  if (view === 'agenda') return `${format(date, 'MMM d')} – ${format(addDays(date, 29), 'MMM d, yyyy')}`
  const start = startOfWeek(date, { weekStartsOn: 0 }); const end = endOfWeek(date, { weekStartsOn: 0 })
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
}

function eventDate(event: CalendarEvent, timeZone: string | null | undefined): Date | undefined {
  return zonedDateTimeParts(event.startsAt, timeZone).date
}

function movedEventTime(event: CalendarEvent, day: Date, viewingTimeZone: string | null | undefined): CalendarEventPatch['time'] | null {
  if (event.kind === 'all-day') {
    const durationDays = Math.max(1, Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 86_400_000))
    return { kind: 'all-day', startDate: format(day, 'yyyy-MM-dd'), endDateExclusive: format(addDays(day, durationDays), 'yyyy-MM-dd') }
  }
  const zone = event.timeZone ?? viewingTimeZone
  const parts = zonedDateTimeParts(event.startsAt, zone)
  const startsAt = zonedDateTimeToIso(day, parts.time, zone)
  if (!startsAt) return null
  const duration = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()
  return { kind: 'timed', startsAt, endsAt: new Date(new Date(startsAt).getTime() + duration).toISOString() }
}

function EventCard({ event, timeZone, onOpen, onResize }: { event: CalendarEvent; timeZone: string | null | undefined; onOpen: (event: CalendarEvent) => void; onResize: (event: CalendarEvent, durationMinutes: number) => void }) {
  const resizeStart = useRef<{ y: number; minutes: number } | null>(null)
  const durationMinutes = Math.max(15, Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000))
  const finishResize = (clientY: number) => {
    const start = resizeStart.current
    if (!start) return
    const change = Math.round((clientY - start.y) / 8) * 15
    resizeStart.current = null
    const next = Math.max(15, start.minutes + change)
    onResize(event, next)
  }
  return (
    <div
      className="border-l-2 border-primary bg-surface"
      draggable
      onDragStart={(drag) => drag.dataTransfer.setData('application/x-maincar-calendar-event', event.id)}
    >
      <button type="button" className="w-full px-2 py-1 text-left text-xs" onClick={() => onOpen(event)} aria-label={`${event.title ?? 'Untitled event'}, ${formatDateTime(event.startsAt, timeZone)}`}>
        <p className="truncate font-medium text-text">{event.title ?? 'Untitled event'}</p>
        <p className="truncate text-text-muted">{event.kind === 'all-day' ? 'All day' : formatDateTime(event.startsAt, event.timeZone ?? timeZone)}</p>
      </button>
      {event.kind === 'timed' ? (
        <div className="flex justify-center border-t border-border">
          <IconButton
            tooltip={`Resize ${event.title ?? 'this event'}`}
            variant="ghost"
            size="icon-sm"
            draggable={false}
            onPointerDown={(pointer) => {
              resizeStart.current = { y: pointer.clientY, minutes: durationMinutes }
              pointer.currentTarget.setPointerCapture(pointer.pointerId)
            }}
            onPointerUp={(pointer) => finishResize(pointer.clientY)}
            onKeyDown={(key) => {
              if (key.key === 'ArrowDown') { key.preventDefault(); onResize(event, durationMinutes + 15) }
              if (key.key === 'ArrowUp') { key.preventDefault(); onResize(event, Math.max(15, durationMinutes - 15)) }
            }}
          >
            <GripHorizontal size={16} />
          </IconButton>
        </div>
      ) : null}
    </div>
  )
}

function MiniMonth({ date, onSelect }: { date: Date; onSelect: (date: Date) => void }) {
  const first = startOfWeek(startOfMonth(date), { weekStartsOn: 0 })
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  return (
    <section className="border border-border bg-bg p-3" aria-label="Mini month">
      <p className="mb-2 text-sm font-semibold">{format(date, 'MMMM yyyy')}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => <Button key={day.toISOString()} type="button" variant={isSameDay(day, date) ? 'default' : 'ghost'} size="icon-sm" className={cn('h-7 w-7 text-xs', !isSameMonth(day, date) && 'text-text-muted')} onClick={() => onSelect(day)} aria-label={`Show ${format(day, 'MMMM d, yyyy')}`}>{format(day, 'd')}</Button>)}
      </div>
    </section>
  )
}

function SourceRail() {
  const { org } = useAuth()
  const sources = useGetCalendarSources(org?.id)
  const updateSource = useUpdateCalendarSource()
  if (sources.isLoading) return <Skeleton className="h-32 w-full" />
  if (sources.isError) return <p className="text-sm text-danger">Could not load calendars. Refresh the page and try again.</p>
  return (
    <section className="border border-border bg-bg p-3" aria-labelledby="calendar-sources-heading">
      <div className="mb-2 flex items-center justify-between"><h2 id="calendar-sources-heading" className="text-sm font-semibold">Calendars</h2><Settings2 size={16} aria-hidden className="text-text-muted" /></div>
      <div className="flex flex-col gap-1">
        {(sources.data?.sources ?? []).map((source) => (
          <Button key={source.id} type="button" variant={source.isPrimary || source.isSelected ? 'secondary' : 'ghost'} size="sm" className="justify-start" aria-pressed={source.isSelected} disabled={source.isPrimary || updateSource.isPending} onClick={() => org && updateSource.mutate({ orgId: org.id, sourceId: source.id, isSelected: !source.isSelected })}>
            <span className="truncate">{source.name}</span>{source.isPrimary && <span className="ml-auto text-xs text-text-muted">Primary</span>}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">Your primary calendar is always visible. Select another calendar to add it.</p>
    </section>
  )
}

function CalendarGrid({ date, view, events, timeZone, onCreate, onOpen, onMove, onResize }: { date: Date; view: CalendarView; events: CalendarEvent[]; timeZone: string | null | undefined; onCreate: (date: Date) => void; onOpen: (event: CalendarEvent) => void; onMove: (event: CalendarEvent, day: Date) => void; onResize: (event: CalendarEvent, durationMinutes: number) => void }) {
  if (view === 'agenda') return <Agenda events={events} timeZone={timeZone} onOpen={onOpen} />
  const days = view === 'day' ? [date] : view === 'week' ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date, { weekStartsOn: 0 }), index)) : Array.from({ length: 42 }, (_, index) => addDays(startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), index))
  return (
    <section className={cn('grid border border-border bg-bg', view === 'month' ? 'grid-cols-7' : view === 'week' ? 'grid-cols-7' : 'grid-cols-1')} aria-label={`${view} calendar`}>
      {days.map((day) => {
        const dayEvents = events.filter((event) => { const starts = eventDate(event, timeZone); return starts && isSameDay(starts, day) })
        return <section
          key={day.toISOString()}
          className={cn('min-h-32 border-b border-r border-border p-2', view === 'month' && !isSameMonth(day, date) && 'bg-surface')}
          aria-label={format(day, 'EEEE, MMMM d')}
          onDragOver={(drag) => drag.preventDefault()}
          onDrop={(drop) => {
            drop.preventDefault()
            const eventId = drop.dataTransfer.getData('application/x-maincar-calendar-event')
            const dropped = events.find((event) => event.id === eventId)
            if (dropped) onMove(dropped, day)
          }}
        >
          <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">{view === 'month' ? format(day, 'd') : format(day, 'EEE d')}</h3><Button type="button" variant="ghost" size="icon-sm" className="h-8 w-8" aria-label={`Create event on ${format(day, 'MMMM d, yyyy')}`} onClick={() => onCreate(day)}><Plus size={16} /></Button></div>
          <div className="flex flex-col gap-1">{dayEvents.map((event) => <EventCard key={event.id} event={event} timeZone={timeZone} onOpen={onOpen} onResize={onResize} />)}</div>
        </section>
      })}
    </section>
  )
}

function Agenda({ events, timeZone, onOpen }: { events: CalendarEvent[]; timeZone: string | null | undefined; onOpen: (event: CalendarEvent) => void }) {
  if (!events.length) return <EmptyState title="No events in this range">Change the range or select another calendar.</EmptyState>
  return <section className="border border-border bg-bg" aria-label="Agenda"><div className="divide-y divide-border">{events.map((event) => <button type="button" key={event.id} className="flex w-full flex-col gap-1 p-3 text-left sm:flex-row sm:items-center sm:justify-between" onClick={() => onOpen(event)}><div><h3 className="text-sm font-medium">{event.title ?? 'Untitled event'}</h3><p className="text-xs text-text-muted">{event.kind === 'all-day' ? formatDate(event.startsAt, timeZone) : formatDateTime(event.startsAt, timeZone)}</p></div><span className="text-xs text-text-muted">{event.kind === 'all-day' ? 'All day' : formatTime(new Date(event.startsAt), timeZone)}</span></button>)}</div></section>
}

export function CalendarWorkspace() {
  const { org, user } = useAuth()
  const [view, setView] = useState<CalendarView>('week')
  const [date, setDate] = useState(() => new Date())
  const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null)
  const [editor, setEditor] = useState<{ event: CalendarEvent | null; date: Date; initialTitle?: string } | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [recurringAction, setRecurringAction] = useState<{ event: CalendarEvent; action: 'move' | 'resize'; patch: CalendarEventPatch } | null>(null)
  const sourceQuery = useGetCalendarSources(org?.id)
  const createEvent = useCreateCalendarEvent()
  const updateEvent = useUpdateCalendarEvent()
  const deleteEvent = useDeleteCalendarEvent()
  const respondToEvent = useRespondToCalendarEvent()
  const range = visibleRange(date, view)
  const eventsQuery = useGetCalendarEvents(org?.id, { startsAt: range.startsAt.toISOString(), endsAt: range.endsAt.toISOString() })
  const timeZone = user?.timeZone
  const changeRange = (direction: -1 | 1) => setDate((current) => view === 'month' ? (direction === 1 ? addMonths(current, 1) : subMonths(current, 1)) : (direction === 1 ? addDays(current, view === 'week' ? 7 : view === 'agenda' ? 30 : 1) : subDays(current, view === 'week' ? 7 : view === 'agenda' ? 30 : 1)))
  const sources = sourceQuery.data?.sources ?? []
  const pending = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending || respondToEvent.isPending
  const selectedSourceId = sources.find((source) => source.isPrimary)?.id ?? sources[0]?.id
  const showError = (action: string, error: Error) => {
    if (error instanceof ApiError && error.status === 409) {
      toast.error('Event changed in Calendar. Refreshing the latest version.')
      void eventsQuery.refetch()
      return
    }
    toast.error(`Could not ${action}. ${error.message}`)
  }
  const createQuick = (title: string) => {
    if (!org || !quickCreateDate || !selectedSourceId) return
    const startsAt = zonedDateTimeToIso(quickCreateDate, '09:00', timeZone); const endsAt = zonedDateTimeToIso(quickCreateDate, '09:30', timeZone)
    if (!startsAt || !endsAt) return
    createEvent.mutate({ orgId: org.id, sourceId: selectedSourceId, title, timeZone: timeZone ?? null, time: { kind: 'timed', startsAt, endsAt } }, { onSuccess: () => { setQuickCreateDate(null); toast.success('Event created.') }, onError: (error) => showError('create the event', error) })
  }
  const saveEvent = (input: CalendarEventCreateInput | CalendarEventPatch, event: CalendarEvent | null, scope: CalendarRecurrenceScope) => {
    if (!org) return
    if (event) updateEvent.mutate({ orgId: org.id, eventId: event.id, expectedVersion: event.providerVersion ?? null, scope, patch: input as CalendarEventPatch }, { onSuccess: () => { setEditor(null); setSelectedEvent(null); toast.success('Event updated.') }, onError: (error) => showError('update the event', error) })
    else createEvent.mutate({ orgId: org.id, ...(input as CalendarEventCreateInput) }, { onSuccess: () => { setEditor(null); toast.success('Event created.') }, onError: (error) => showError('create the event', error) })
  }
  const duplicateEvent = (event: CalendarEvent) => {
    if (!org) return
    const time = event.kind === 'all-day' ? { kind: 'all-day' as const, startDate: event.startsAt.slice(0, 10), endDateExclusive: event.endsAt.slice(0, 10) } : { kind: 'timed' as const, startsAt: event.startsAt, endsAt: event.endsAt }
    createEvent.mutate({ orgId: org.id, sourceId: event.sourceId, title: `Copy of ${event.title ?? 'event'}`, location: event.location, description: event.description, status: event.status, availability: event.availability, privacy: event.privacy, meetingLink: event.meetingLink, timeZone: event.timeZone, links: event.links, time }, { onSuccess: () => { setSelectedEvent(null); toast.success('Event duplicated.') }, onError: (error) => showError('duplicate the event', error) })
  }
  const removeEvent = (event: CalendarEvent, scope: CalendarRecurrenceScope) => {
    if (!org) return
    deleteEvent.mutate({ orgId: org.id, eventId: event.id, expectedVersion: event.providerVersion ?? null, scope }, { onSuccess: () => { setSelectedEvent(null); toast.success('Event deleted.') }, onError: (error) => showError('delete the event', error) })
  }
  const moveEvent = (event: CalendarEvent, day: Date) => {
    if (!org) return
    const time = movedEventTime(event, day, timeZone)
    if (!time) return toast.error('Could not move the event. Choose another day and try again.')
    const patch = { time, timeZone: event.kind === 'all-day' ? null : event.timeZone ?? timeZone ?? null }
    if (event.recurrenceKind === 'series') return setRecurringAction({ event, action: 'move', patch })
    updateEvent.mutate({ orgId: org.id, eventId: event.id, expectedVersion: event.providerVersion ?? null, scope: 'this-event', patch }, { onSuccess: () => toast.success('Event moved.'), onError: (error) => showError('move the event', error) })
  }
  const resizeEvent = (event: CalendarEvent, durationMinutes: number) => {
    if (!org || event.kind !== 'timed') return
    const endsAt = new Date(new Date(event.startsAt).getTime() + durationMinutes * 60_000).toISOString()
    const patch = { time: { kind: 'timed' as const, startsAt: event.startsAt, endsAt }, timeZone: event.timeZone ?? timeZone ?? null }
    if (event.recurrenceKind === 'series') return setRecurringAction({ event, action: 'resize', patch })
    updateEvent.mutate({ orgId: org.id, eventId: event.id, expectedVersion: event.providerVersion ?? null, scope: 'this-event', patch }, { onSuccess: () => toast.success('Event resized.'), onError: (error) => showError('resize the event', error) })
  }
  const applyRecurringAction = (scope: CalendarRecurrenceScope) => {
    if (!org || !recurringAction) return
    const { event, action, patch } = recurringAction
    setRecurringAction(null)
    updateEvent.mutate({ orgId: org.id, eventId: event.id, expectedVersion: event.providerVersion ?? null, scope, patch }, {
      onSuccess: () => toast.success(action === 'move' ? 'Event moved.' : 'Event resized.'),
      onError: (error) => showError(action === 'move' ? 'move the event' : 'resize the event', error),
    })
  }
  const respondToInvitation = (event: CalendarEvent, response: Exclude<CalendarAttendeeResponse, 'needs-action'>, scope: CalendarRecurrenceScope) => {
    if (!org) return
    respondToEvent.mutate({ orgId: org.id, eventId: event.id, response, scope }, { onSuccess: () => toast.success('Response sent.'), onError: (error) => showError('send the response', error) })
  }

  if (sourceQuery.isLoading) return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><Skeleton className="h-96 w-full" /></div></main>
  if (sourceQuery.isError) return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><EmptyState title="Could not load Calendar">Refresh the page and try again.</EmptyState></div></main>
  if (sourceQuery.data?.calendar.state === 'not-connected') return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><EmptyState title="Connect Calendar"><p>Connect Google or Microsoft Calendar to see your schedule.</p><Button asChild><Link to="/settings/integrations">Open Integrations</Link></Button></EmptyState></div></main>

  return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" count={eventsQuery.data?.total} /><div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-6 lg:grid-cols-[224px_minmax(0,1fr)]"><aside className="flex flex-col gap-3"><MiniMonth date={date} onSelect={setDate} /><SourceRail /></aside><section className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><div className="flex border border-border bg-surface p-1">{VIEWS.map((item) => <Button key={item.id} type="button" variant={view === item.id ? 'default' : 'ghost'} size="sm" onClick={() => setView(item.id)} aria-label={`Show ${item.label.toLowerCase()} view`}>{item.label}</Button>)}</div><Button type="button" variant="secondary" size="sm" onClick={() => setDate(new Date())}>Today</Button><IconButton tooltip="Show previous time range" onClick={() => changeRange(-1)}><ChevronLeft size={16} /></IconButton><IconButton tooltip="Show next time range" onClick={() => changeRange(1)}><ChevronRight size={16} /></IconButton><h2 className="text-sm font-semibold" aria-live="polite">{rangeLabel(date, view)}</h2><span className="ml-auto text-xs text-text-muted">Times shown in {formatTimeZoneName(range.startsAt, timeZone)}</span></div>{eventsQuery.isLoading ? <Skeleton className="h-96 w-full" /> : eventsQuery.isError ? <EmptyState title="Could not load events">Change the range or refresh the page and try again.</EmptyState> : <CalendarGrid date={date} view={view} events={eventsQuery.data?.events ?? []} timeZone={timeZone} onCreate={setQuickCreateDate} onOpen={setSelectedEvent} onMove={moveEvent} onResize={resizeEvent} />}</section></div>{quickCreateDate ? <CalendarWorkspace_QuickCreate open date={quickCreateDate} busy={pending} onOpenChange={(open) => !open && setQuickCreateDate(null)} onCreate={createQuick} onMoreDetails={(initialTitle) => { setEditor({ event: null, date: quickCreateDate, initialTitle }); setQuickCreateDate(null) }} /> : null}{editor ? <CalendarWorkspace_EventEditor event={editor.event} date={editor.date} sources={sources} orgId={org?.id} timeZone={timeZone} initialTitle={editor.initialTitle} open busy={pending} onOpenChange={(open) => !open && setEditor(null)} onSave={saveEvent} /> : null}{selectedEvent ? <CalendarWorkspace_EventDetails event={selectedEvent} source={sources.find((source) => source.id === selectedEvent.sourceId)} userEmail={user?.email} timeZone={timeZone} busy={pending} onOpenChange={(open) => !open && setSelectedEvent(null)} onEdit={() => { setEditor({ event: selectedEvent, date: eventDate(selectedEvent, timeZone) ?? date }); setSelectedEvent(null) }} onDuplicate={() => duplicateEvent(selectedEvent)} onDelete={(scope) => removeEvent(selectedEvent, scope)} onRespond={(response, scope) => respondToInvitation(selectedEvent, response, scope)} /> : null}{recurringAction ? <CalendarWorkspace_RecurringActionDialog action={recurringAction.action} source={sources.find((source) => source.id === recurringAction.event.sourceId)} busy={pending} onCancel={() => setRecurringAction(null)} onConfirm={applyRecurringAction} /> : null}</main>
}
