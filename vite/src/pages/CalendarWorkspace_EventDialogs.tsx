import { addDays, format } from 'date-fns'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SelectedValuesPicker } from '@/components/ui/selected-values-picker'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMentionSuggestions } from '@/components/editor/useMentionSuggestions'
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventPatch, CalendarRecordLink, CalendarSource } from '@/lib/calendarTypes'
import { formatDate, formatDateTime, formatTimeZoneName, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'

type EditorValue = {
  title: string
  sourceId: string
  date: Date
  startTime: string
  durationMinutes: string
  allDay: boolean
  timeZone: string
  location: string
  description: string
  availability: CalendarEvent['availability']
  privacy: CalendarEvent['privacy']
  meetingLink: string
  links: string[]
}

function linkValue(link: CalendarRecordLink): string {
  return JSON.stringify(link)
}

function parseLinkValue(value: string): CalendarRecordLink | null {
  try {
    const parsed = JSON.parse(value) as Partial<CalendarRecordLink>
    return typeof parsed.object === 'string' && typeof parsed.id === 'string'
      ? { object: parsed.object, id: parsed.id }
      : null
  } catch {
    return null
  }
}

function allDayDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toEditorValue(
  event: CalendarEvent | null,
  date: Date,
  sourceId: string,
  viewingTimeZone: string | null | undefined,
  initialTitle = '',
): EditorValue {
  const timeZone = event?.timeZone ?? viewingTimeZone ?? 'UTC'
  if (!event) {
    return {
      title: initialTitle,
      sourceId,
      date,
      startTime: '09:00',
      durationMinutes: '30',
      allDay: false,
      timeZone,
      location: '',
      description: '',
      availability: 'busy',
      privacy: 'default',
      meetingLink: '',
      links: [],
    }
  }
  const start = zonedDateTimeParts(event.startsAt, timeZone)
  const duration = Math.max(15, Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000))
  return {
    title: event.title ?? '',
    sourceId: event.sourceId,
    date: event.kind === 'all-day' ? allDayDate(event.startsAt) : start.date ?? date,
    startTime: start.time || '09:00',
    durationMinutes: String(duration),
    allDay: event.kind === 'all-day',
    timeZone,
    location: event.location ?? '',
    description: event.description ?? '',
    availability: event.availability ?? 'busy',
    privacy: event.privacy ?? 'default',
    meetingLink: event.meetingLink ?? '',
    links: (event.links ?? []).map(linkValue),
  }
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function eventPayload(
  value: EditorValue,
): { input: CalendarEventCreateInput | CalendarEventPatch } | { error: string } {
  const links = value.links.flatMap((item) => {
    const parsed = parseLinkValue(item)
    return parsed ? [parsed] : []
  })
  const common = {
    title: value.title.trim() || null,
    location: value.location.trim() || null,
    description: value.description || null,
    availability: value.availability,
    privacy: value.privacy,
    meetingLink: value.meetingLink.trim() || null,
    timeZone: value.timeZone,
    links,
  }

  if (!validTimeZone(value.timeZone)) return { error: 'Enter a valid IANA timezone.' }
  if (value.meetingLink.trim()) {
    try {
      const url = new URL(value.meetingLink)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Enter an http or https meeting link.' }
    } catch {
      return { error: 'Enter a valid meeting link.' }
    }
  }
  if (value.allDay) {
    const startDate = format(value.date, 'yyyy-MM-dd')
    return { input: { ...common, timeZone: null, time: { kind: 'all-day', startDate, endDateExclusive: format(addDays(value.date, 1), 'yyyy-MM-dd') } } }
  }

  const startsAt = zonedDateTimeToIso(value.date, value.startTime, value.timeZone)
  if (!startsAt) return { error: 'Enter a valid start time.' }
  const durationMinutes = Number(value.durationMinutes)
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) return { error: 'Choose a valid duration.' }
  const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString()
  return { input: { ...common, time: { kind: 'timed', startsAt, endsAt } } }
}

interface FullEditorProps {
  event: CalendarEvent | null
  date: Date
  sources: CalendarSource[]
  orgId: string | null | undefined
  timeZone: string | null | undefined
  initialTitle?: string
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSave: (input: CalendarEventCreateInput | CalendarEventPatch, event: CalendarEvent | null) => void
}

export function CalendarWorkspace_EventEditor({
  event,
  date,
  sources,
  orgId,
  timeZone,
  initialTitle,
  open,
  busy,
  onOpenChange,
  onSave,
}: FullEditorProps) {
  const defaultSourceId = sources.find((source) => source.isPrimary)?.id ?? sources[0]?.id ?? ''
  const [value, setValue] = useState(() => toEditorValue(event, date, defaultSourceId, timeZone, initialTitle))
  const [error, setError] = useState('')
  const mentions = useMentionSuggestions(orgId)
  const recordOptions = useMemo(() => mentions.items.flatMap((item) => {
    if (item.kind === 'teammate') return []
    const object = item.kind === 'contact' ? 'person' : item.kind
    return [{ value: linkValue({ object, id: item.id }), label: `${item.label} · ${item.detail}` }]
  }), [mentions.items])

  const update = (patch: Partial<EditorValue>) => setValue((current) => ({ ...current, ...patch }))
  const selectedProvider = sources.find((source) => source.id === value.sourceId)?.provider
  const selectSource = (sourceId: string) => {
    const provider = sources.find((source) => source.id === sourceId)?.provider
    update({ sourceId, ...(provider === 'microsoft' && value.privacy === 'public' ? { privacy: 'default' } : {}) })
  }
  const durationOptions = [15, 30, 45, 60, 90, 120]
  const currentDuration = Number(value.durationMinutes)
  if (Number.isFinite(currentDuration) && !durationOptions.includes(currentDuration)) durationOptions.push(currentDuration)
  durationOptions.sort((left, right) => left - right)
  const submit = () => {
    const result = eventPayload(value)
    if ('error' in result) return setError(result.error)
    onSave(event ? result.input : { ...result.input, sourceId: value.sourceId } as CalendarEventCreateInput, event)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{event ? 'Edit event' : 'New event'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="calendar-event-title">Title</Label>
            <Input id="calendar-event-title" className="h-8" value={value.title} onChange={(input) => update({ title: input.target.value })} autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Calendar</Label>
            <Select value={value.sourceId} onValueChange={selectSource} disabled={!!event}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
            </Select>
            {event ? <p className="text-xs text-text-muted">Calendar stays fixed after creation.</p> : null}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="calendar-event-all-day">All day</Label>
            <Switch id="calendar-event-all-day" checked={value.allDay} onCheckedChange={(allDay) => update({ allDay })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Date</Label>
            <DatePicker value={value.date} onChange={(next) => next && update({ date: next })} ariaLabel="Choose event date" />
          </div>
          {!value.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="calendar-event-start">Start time</Label>
                <Input id="calendar-event-start" className="h-8" type="time" value={value.startTime} onChange={(input) => update({ startTime: input.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Duration</Label>
                <Select value={value.durationMinutes} onValueChange={(durationMinutes) => update({ durationMinutes })}>
                  <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {durationOptions.map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {!value.allDay ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="calendar-event-time-zone">Timezone</Label>
              <Input id="calendar-event-time-zone" className="h-8" value={value.timeZone} onChange={(input) => update({ timeZone: input.target.value })} />
              <p className="text-xs text-text-muted">Times use {validTimeZone(value.timeZone) ? formatTimeZoneName(value.date, value.timeZone) : 'the selected IANA timezone'}.</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="calendar-event-location">Location</Label>
            <Input id="calendar-event-location" className="h-8" value={value.location} onChange={(input) => update({ location: input.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="calendar-event-description">Description</Label>
            <Textarea id="calendar-event-description" className="resize-none" value={value.description} onChange={(input) => update({ description: input.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>Availability</Label>
              <Select value={value.availability} onValueChange={(availability) => update({ availability: availability as CalendarEvent['availability'] })}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="busy">Busy</SelectItem><SelectItem value="free">Free</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Privacy</Label>
              <Select value={value.privacy} onValueChange={(privacy) => update({ privacy: privacy as CalendarEvent['privacy'] })}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">Calendar default</SelectItem>{selectedProvider === 'google' ? <SelectItem value="public">Public</SelectItem> : null}<SelectItem value="private">Private</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="calendar-event-meeting-link">Meeting link</Label>
            <Input id="calendar-event-meeting-link" className="h-8" type="url" value={value.meetingLink} onChange={(input) => update({ meetingLink: input.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>CRM records</Label>
            <SelectedValuesPicker label="Link CRM records" options={recordOptions} value={value.links} onValueChange={(links) => update({ links })} disabled={mentions.isPending} />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy} onClick={submit}>{busy ? 'Saving' : event ? 'Save changes' : 'Create event'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface QuickCreateProps {
  open: boolean
  date: Date
  onOpenChange: (open: boolean) => void
  onCreate: (title: string) => void
  onMoreDetails: (title: string) => void
  busy: boolean
}

export function CalendarWorkspace_QuickCreate({ open, date, onOpenChange, onCreate, onMoreDetails, busy }: QuickCreateProps) {
  const [title, setTitle] = useState('')
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Quick create event</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="quick-event-title">Title</Label>
            <Input id="quick-event-title" className="h-8" value={title} onChange={(input) => setTitle(input.target.value)} autoFocus />
          </div>
          <p className="text-xs text-text-muted">{formatDate(date, undefined)}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onMoreDetails(title)}>Edit details</Button>
          <Button type="button" size="sm" disabled={busy || !title.trim()} onClick={() => onCreate(title)}>Create event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DetailsProps {
  event: CalendarEvent | null
  timeZone: string | null | undefined
  busy: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export function CalendarWorkspace_EventDetails({ event, timeZone, busy, onOpenChange, onEdit, onDuplicate, onDelete }: DetailsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <>
      <Sheet open={!!event} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 bg-bg p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border p-4 pr-12"><SheetTitle>{event?.title ?? 'Untitled event'}</SheetTitle></SheetHeader>
          {event ? (
            <div className="flex flex-col gap-3 overflow-auto p-4">
              <p className="text-sm">{event.kind === 'all-day' ? 'All day' : formatDateTime(event.startsAt, event.timeZone ?? timeZone)}</p>
              <p className="text-xs text-text-muted">{event.source?.name ?? 'Calendar'} · {event.availability === 'free' ? 'Free' : 'Busy'} · {event.privacy === 'private' ? 'Private' : event.privacy === 'public' ? 'Public' : 'Calendar default'}</p>
              {event.location ? <p className="text-sm">{event.location}</p> : null}
              {event.meetingLink ? <a className="text-sm text-primary underline" href={event.meetingLink} target="_blank" rel="noreferrer">Open meeting link</a> : null}
              {event.description ? <p className="whitespace-pre-wrap text-sm">{event.description}</p> : null}
              {event.links.length ? <p className="text-xs text-text-muted">{event.links.length} linked CRM {event.links.length === 1 ? 'record' : 'records'}</p> : null}
            </div>
          ) : null}
          <SheetFooter className="border-t border-border">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={onEdit}><Pencil size={16} />Edit event</Button>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onDuplicate}><Copy size={16} />Duplicate</Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Delete</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {event?.title ?? 'this event'}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => { setConfirmDelete(false); onDelete() }}>Delete event</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
