import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AudioPlayer } from '@/components/call-review/AudioPlayer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGetCallDetail } from '@/hooks/dialer'
import type { AccountTimelineDetail } from '@/lib/accountTimelineTypes'

export function AccountTimelineDetailPanel({
  open,
  onOpenChange,
  orgId,
  detail,
  navigation,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId?: string | null
  detail: AccountTimelineDetail | null
  navigation: { previousEventId: string | null; nextEventId: string | null } | null
  onNavigate: (eventId: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[540px]">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div>
              <SheetTitle className="text-base">{detail ? detail.type.replace('_', ' ') : 'Activity detail'}</SheetTitle>
              <SheetDescription>{detail ? 'Source-authoritative activity detail.' : 'Loading activity detail.'}</SheetDescription>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="secondary" size="sm" disabled={!navigation?.previousEventId} onClick={() => navigation?.previousEventId && onNavigate(navigation.previousEventId)}>
                <ChevronLeft size={16} aria-hidden="true" /> <span className="sr-only">Previous timeline event</span>
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!navigation?.nextEventId} onClick={() => navigation?.nextEventId && onNavigate(navigation.nextEventId)}>
                <ChevronRight size={16} aria-hidden="true" /> <span className="sr-only">Next timeline event</span>
              </Button>
            </div>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {detail ? <DetailBody detail={detail} orgId={orgId} /> : <p className="text-sm text-text-muted">Loading activity detail…</p>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({ detail, orgId }: { detail: AccountTimelineDetail; orgId?: string | null }) {
  const transcript = typeof detail.transcript === 'string' ? detail.transcript : null
  const body = typeof detail.bodyText === 'string' ? detail.bodyText : typeof detail.body === 'string' ? detail.body : null
  const fullCallPath = typeof detail.openFullCallPath === 'string' ? detail.openFullCallPath : null

  return (
    <div className="flex flex-col gap-4 text-sm">
      {detail.type === 'email' && <EmailDetail detail={detail} />}
      {detail.type === 'sms' && <SmsDetail detail={detail} />}
      {detail.type === 'meeting' && <MeetingDetail detail={detail} />}
      {detail.type === 'task' && <TaskDetail detail={detail} />}
      {body && <p className="whitespace-pre-wrap text-text">{body}</p>}
      {transcript && <section><h3 className="mb-2 text-sm font-semibold text-text">Transcript</h3><p className="whitespace-pre-wrap text-text-muted">{transcript}</p></section>}
      {detail.type === 'call' && orgId && <CallPlayer orgId={orgId} callId={detail.id} />}
      {fullCallPath && <a className="text-sm font-medium text-primary underline" href={fullCallPath}>Open full call</a>}
      {detail.type === 'stage_change' && <p className="text-sm text-text-muted">This stage change is preserved as the timeline’s before-and-after snapshot.</p>}
      {!body && !transcript && !fullCallPath && <p className="text-sm text-text-muted">This event has no additional detail to show.</p>}
    </div>
  )
}

function EmailDetail({ detail }: { detail: AccountTimelineDetail }) {
  const participants = Array.isArray(detail.participants) ? detail.participants as Array<{ role?: string; name?: string | null; address?: string }> : []
  const labels = ['from', 'to', 'cc'].map((role) => {
    const names = participants.filter((participant) => participant.role === role).map((participant) => participant.name || participant.address).filter(Boolean)
    return names.length > 0 ? <p key={role} className="text-sm text-text-muted">{role}: {names.join(', ')}</p> : null
  })
  return <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold text-text">{String(detail.subject ?? '(no subject)')}</h3>{labels}</section>
}

function SmsDetail({ detail }: { detail: AccountTimelineDetail }) {
  const direction = detail.direction === 'outbound' ? 'Sent' : 'Received'
  return <p className="self-start rounded-md border border-border bg-surface p-3 text-sm text-text">{direction}: {String(detail.body ?? '')}</p>
}

function MeetingDetail({ detail }: { detail: AccountTimelineDetail }) {
  const attendees = Array.isArray(detail.attendees) ? detail.attendees as Array<{ name?: string | null; email?: string }> : []
  return <section><h3 className="mb-2 text-sm font-semibold text-text">{String(detail.title ?? 'Meeting')}</h3>{attendees.length > 0 && <p className="text-sm text-text-muted">Attendees: {attendees.map((attendee) => attendee.name || attendee.email).filter(Boolean).join(', ')}</p>}</section>
}

function TaskDetail({ detail }: { detail: AccountTimelineDetail }) {
  return <section><h3 className="text-sm font-semibold text-text">{String(detail.title ?? 'Task')}</h3><p className="text-sm text-text-muted">{detail.isDone ? 'Completed' : 'Open'}</p></section>
}

function CallPlayer({ orgId, callId }: { orgId: string; callId: string }) {
  const query = useGetCallDetail(orgId, callId)
  const recording = query.data?.call.review?.recording
  const source = recording?.source
  if (!query.data || !source || source.kind !== 'audio') return null
  return <AudioPlayer source={{ ...source, kind: 'audio' }} recordingState={recording.state} callLabel={query.data.call.toE164} />
}
