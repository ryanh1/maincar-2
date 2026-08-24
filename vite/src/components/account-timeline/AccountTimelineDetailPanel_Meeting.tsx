import { Button } from '@/components/ui/button'
import type { AccountTimelineMeetingDetail } from '@/lib/accountTimelineTypes'
import { formatDate, formatDateTime } from '@/lib/datetime'

const MEETING_STATUS: Record<string, string> = {
  confirmed: 'Confirmed',
  tentative: 'Tentative',
  cancelled: 'Cancelled',
}

const RESPONSE_STATUS: Record<string, string> = {
  needs_action: 'No response',
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
}

function meetingTime(detail: AccountTimelineMeetingDetail, timeZone?: string | null): string {
  if (detail.isAllDay && detail.startDate) return `${formatDate(detail.startDate, timeZone)} · All day`
  if (!detail.startsAt) return 'Time unavailable'
  const start = formatDateTime(detail.startsAt, timeZone)
  const end = detail.endsAt ? formatDateTime(detail.endsAt, timeZone) : null
  return end ? `${start} to ${end}` : start
}

function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export function AccountTimelineDetailPanel_Meeting({ detail, timeZone }: { detail: AccountTimelineMeetingDetail; timeZone?: string | null }) {
  const recordingUrl = safeExternalUrl(detail.recordingUrl)
  const joinUrl = safeExternalUrl(detail.joinUrl)
  const webLink = safeExternalUrl(detail.webLink)
  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-1 border-b border-border pb-4">
        <h3 className="text-sm font-semibold">{detail.title}</h3>
        <p className="text-xs text-text-muted">{meetingTime(detail, timeZone)}</p>
        <p className="text-xs text-text-muted">{MEETING_STATUS[detail.status] ?? 'Status unavailable'}{detail.location ? ` · ${detail.location}` : ''}</p>
      </section>

      {detail.attendees.length > 0 && (
        <section aria-labelledby="meeting-attendees-heading" className="flex flex-col gap-2">
          <h3 id="meeting-attendees-heading" className="text-sm font-semibold">Attendees</h3>
          <ul className="divide-y divide-border border border-border">
            {detail.attendees.map((attendee) => (
              <li key={attendee.id} className="flex min-w-0 items-center justify-between gap-3 p-3">
                <span className="min-w-0 truncate">{attendee.name || attendee.email}</span>
                <span className="shrink-0 text-xs text-text-muted">{RESPONSE_STATUS[attendee.responseStatus] ?? 'Response unavailable'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.description && (
        <section aria-labelledby="meeting-notes-heading">
          <h3 id="meeting-notes-heading" className="mb-2 text-sm font-semibold">Agenda and notes</h3>
          <p className="whitespace-pre-wrap text-text">{detail.description}</p>
        </section>
      )}

      {(detail.hasRecording || detail.transcriptStatus) && (
        <section aria-labelledby="meeting-assets-heading" className="flex flex-col gap-2 border border-border bg-surface p-3">
          <h3 id="meeting-assets-heading" className="text-sm font-semibold">Meeting assets</h3>
          {detail.hasRecording && (
            recordingUrl
              ? <Button asChild type="button" size="sm" variant="secondary"><a href={recordingUrl} target="_blank" rel="noreferrer">Open recording</a></Button>
              : <p className="text-sm text-text-muted">The recording is unavailable. Refresh the meeting and try again.</p>
          )}
          {detail.transcriptStatus && <p className="text-sm text-text-muted">Transcript: {detail.transcriptStatus === 'done' ? 'Ready' : detail.transcriptStatus === 'pending' ? 'Processing' : 'Unavailable'}</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {joinUrl && <Button asChild type="button" size="sm"><a href={joinUrl} target="_blank" rel="noreferrer">Join meeting</a></Button>}
        {webLink && <Button asChild type="button" size="sm" variant="secondary"><a href={webLink} target="_blank" rel="noreferrer">Open calendar event</a></Button>}
      </div>
    </div>
  )
}
