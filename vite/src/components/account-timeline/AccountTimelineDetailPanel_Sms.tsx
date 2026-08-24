import { Button } from '@/components/ui/button'
import type { AccountTimelineSmsDetail, AccountTimelineSmsMessage } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  undelivered: 'Not delivered',
  failed: 'Failed',
  received: 'Received',
}

function messageTime(message: AccountTimelineSmsMessage): string {
  return message.sentAt ?? message.deliveredAt ?? message.createdAt
}

function MessageBubble({ message, timeZone }: { message: AccountTimelineSmsMessage; timeZone?: string | null }) {
  const outbound = message.direction === 'outbound'
  return (
    <li className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <article className={`flex max-w-[85%] flex-col gap-1 rounded-md border border-border p-3 ${outbound ? 'bg-surface-2' : 'bg-bg'}`} aria-label={`${outbound ? 'Sent' : 'Received'} text message`}>
        <p className="whitespace-pre-wrap break-words text-sm text-text">{message.body || 'Media message'}</p>
        {message.media.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-border pt-2">
            {message.media.map((media) => (
              <li key={media.id} className="text-xs text-text-muted">
                {media.contentType}{media.sizeBytes !== null ? ` · ${Math.round(media.sizeBytes / 1_024)} KB` : ''}{!media.isStored ? ' · unavailable' : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-muted">
          {formatDateTime(messageTime(message), timeZone)} · {STATUS_LABELS[message.status] ?? 'Status unavailable'}
        </p>
      </article>
    </li>
  )
}

export function AccountTimelineDetailPanel_Sms({ detail, timeZone }: { detail: AccountTimelineSmsDetail; timeZone?: string | null }) {
  const conversation = detail.conversation?.length ? detail.conversation : [detail]
  const counterpart = detail.direction === 'outbound' ? detail.toE164 : detail.fromE164
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{counterpart}</h3>
          <p className="text-xs text-text-muted">{conversation.length} {conversation.length === 1 ? 'message' : 'messages'}</p>
        </div>
        <Button asChild type="button" size="sm"><a href={`sms:${counterpart}`}>Reply by text</a></Button>
      </div>
      <ol aria-label="Text conversation" className="flex flex-col gap-3">
        {conversation.map((message) => <MessageBubble key={message.id} message={message} timeZone={timeZone} />)}
      </ol>
    </div>
  )
}
