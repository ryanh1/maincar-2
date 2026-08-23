import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetCalendarEvents, useGetCalendarSources, useUpdateCalendarSource } from '@/hooks/calendar'
import type { CalendarEvent } from '@/lib/calendarTypes'
import { formatDate, formatDateTime, formatTime, formatTimeZoneName, zonedDateTimeParts } from '@/lib/datetime'
import { useAuth } from '@/providers/useAuth'
import { cn } from '@/lib/utils'

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

function EventCard({ event, timeZone }: { event: CalendarEvent; timeZone: string | null | undefined }) {
  return (
    <article className="border-l-2 border-primary bg-surface px-2 py-1 text-xs" aria-label={`${event.title ?? 'Untitled event'}, ${formatDateTime(event.startsAt, timeZone)}`}>
      <p className="truncate font-medium text-text">{event.title ?? 'Untitled event'}</p>
      <p className="truncate text-text-muted">{event.kind === 'all-day' ? 'All day' : formatDateTime(event.startsAt, timeZone)}</p>
    </article>
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

function CalendarGrid({ date, view, events, timeZone }: { date: Date; view: CalendarView; events: CalendarEvent[]; timeZone: string | null | undefined }) {
  if (view === 'agenda') return <Agenda events={events} timeZone={timeZone} />
  const days = view === 'day' ? [date] : view === 'week' ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date, { weekStartsOn: 0 }), index)) : Array.from({ length: 42 }, (_, index) => addDays(startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), index))
  return (
    <section className={cn('grid border border-border bg-bg', view === 'month' ? 'grid-cols-7' : view === 'week' ? 'grid-cols-7' : 'grid-cols-1')} aria-label={`${view} calendar`}>
      {days.map((day) => {
        const dayEvents = events.filter((event) => { const starts = eventDate(event, timeZone); return starts && isSameDay(starts, day) })
        return <section key={day.toISOString()} className={cn('min-h-32 border-b border-r border-border p-2', view === 'month' && !isSameMonth(day, date) && 'bg-surface')} aria-label={format(day, 'EEEE, MMMM d')}>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">{view === 'month' ? format(day, 'd') : format(day, 'EEE d')}</h3>{isSameDay(day, new Date()) && <span className="text-xs text-primary">Today</span>}</div>
          <div className="flex flex-col gap-1">{dayEvents.map((event) => <EventCard key={event.id} event={event} timeZone={timeZone} />)}</div>
        </section>
      })}
    </section>
  )
}

function Agenda({ events, timeZone }: { events: CalendarEvent[]; timeZone: string | null | undefined }) {
  if (!events.length) return <EmptyState title="No events in this range">Change the range or select another calendar.</EmptyState>
  return <section className="border border-border bg-bg" aria-label="Agenda"><div className="divide-y divide-border">{events.map((event) => <article key={event.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-medium">{event.title ?? 'Untitled event'}</h3><p className="text-xs text-text-muted">{event.kind === 'all-day' ? formatDate(event.startsAt, timeZone) : formatDateTime(event.startsAt, timeZone)}</p></div><span className="text-xs text-text-muted">{event.kind === 'all-day' ? 'All day' : formatTime(new Date(event.startsAt), timeZone)}</span></article>)}</div></section>
}

export function CalendarWorkspace() {
  const { org, user } = useAuth()
  const [view, setView] = useState<CalendarView>('week')
  const [date, setDate] = useState(() => new Date())
  const sourceQuery = useGetCalendarSources(org?.id)
  const range = visibleRange(date, view)
  const eventsQuery = useGetCalendarEvents(org?.id, { startsAt: range.startsAt.toISOString(), endsAt: range.endsAt.toISOString() })
  const timeZone = user?.timeZone
  const changeRange = (direction: -1 | 1) => setDate((current) => view === 'month' ? (direction === 1 ? addMonths(current, 1) : subMonths(current, 1)) : (direction === 1 ? addDays(current, view === 'week' ? 7 : view === 'agenda' ? 30 : 1) : subDays(current, view === 'week' ? 7 : view === 'agenda' ? 30 : 1)))

  if (sourceQuery.isLoading) return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><Skeleton className="h-96 w-full" /></div></main>
  if (sourceQuery.isError) return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><EmptyState title="Could not load Calendar">Refresh the page and try again.</EmptyState></div></main>
  if (sourceQuery.data?.calendar.state === 'not-connected') return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" /><div className="p-6"><EmptyState title="Connect Calendar"><p>Connect Google or Microsoft Calendar to see your schedule.</p><Button asChild><Link to="/settings/integrations">Open Integrations</Link></Button></EmptyState></div></main>

  return <main className="flex min-h-0 flex-1 flex-col"><PageHeader icon={CalendarDays} title="Calendar" count={eventsQuery.data?.total} /><div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-6 lg:grid-cols-[224px_minmax(0,1fr)]"><aside className="flex flex-col gap-3"><MiniMonth date={date} onSelect={setDate} /><SourceRail /></aside><section className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><div className="flex border border-border bg-surface p-1">{VIEWS.map((item) => <Button key={item.id} type="button" variant={view === item.id ? 'default' : 'ghost'} size="sm" onClick={() => setView(item.id)} aria-label={`Show ${item.label.toLowerCase()} view`}>{item.label}</Button>)}</div><Button type="button" variant="secondary" size="sm" onClick={() => setDate(new Date())}>Today</Button><IconButton tooltip="Show previous time range" onClick={() => changeRange(-1)}><ChevronLeft size={16} /></IconButton><IconButton tooltip="Show next time range" onClick={() => changeRange(1)}><ChevronRight size={16} /></IconButton><h2 className="text-sm font-semibold" aria-live="polite">{rangeLabel(date, view)}</h2><span className="ml-auto text-xs text-text-muted">Times shown in {formatTimeZoneName(range.startsAt, timeZone)}</span></div>{eventsQuery.isLoading ? <Skeleton className="h-96 w-full" /> : eventsQuery.isError ? <EmptyState title="Could not load events">Change the range or refresh the page and try again.</EmptyState> : <CalendarGrid date={date} view={view} events={eventsQuery.data?.events ?? []} timeZone={timeZone} />}</section></div></main>
}
