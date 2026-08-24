import { useMemo } from 'react'

import { useComposerOptional } from '@/components/composer/composerContext'
import { SanitizedHtml } from '@/components/editor/SanitizedHtml'
import { sanitizeStoredHtml } from '@/components/editor/sanitizeStoredHtml'
import { Button } from '@/components/ui/button'
import type { AccountTimelineEmailDetail } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'

function prefixedSubject(subject: string | null, prefix: 'Re' | 'Fwd'): string {
  const value = subject?.trim() || '(no subject)'
  return new RegExp(`^${prefix}:`, 'i').test(value) ? value : `${prefix}: ${value}`
}

function htmlFromText(value: string): string {
  const element = document.createElement('div')
  element.textContent = value
  return `<p>${element.innerHTML.replace(/\n/g, '<br>')}</p>`
}

function splitPlainText(value: string): { visible: string; quote: string | null } {
  const match = /\n(?=(?:On .+ wrote:|From:\s))/i.exec(value)
  if (!match || match.index === undefined) return { visible: value, quote: null }
  return { visible: value.slice(0, match.index).trim(), quote: value.slice(match.index).trim() }
}

function splitHtml(value: string): { visible: string; quote: string | null } {
  const documentValue = new DOMParser().parseFromString(value, 'text/html')
  const quoted = documentValue.body.querySelector('blockquote, .gmail_quote, .yahoo_quoted')
  if (!quoted) return { visible: value, quote: null }
  const quote = quoted.outerHTML
  quoted.remove()
  return { visible: documentValue.body.innerHTML, quote }
}

function participantLine(detail: AccountTimelineEmailDetail, role: string): string | null {
  const values = detail.participants
    .filter((participant) => participant.role === role)
    .map((participant) => participant.name ? `${participant.name} <${participant.address}>` : participant.address)
  return values.length > 0 ? values.join(', ') : null
}

function formatBytes(value: number | null): string | null {
  if (value === null) return null
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

export function AccountTimelineDetailPanel_Email({ detail, timeZone }: { detail: AccountTimelineEmailDetail; timeZone?: string | null }) {
  const composer = useComposerOptional()
  const body = useMemo(
    () => detail.bodyHtml ? splitHtml(detail.bodyHtml) : splitPlainText(detail.bodyText ?? ''),
    [detail.bodyHtml, detail.bodyText],
  )
  const from = participantLine(detail, 'from')
  const replyTo = participantLine(detail, 'reply_to')
  const to = participantLine(detail, 'to')
  const cc = participantLine(detail, 'cc')
  const date = detail.sentAt ?? detail.receivedAt ?? detail.occurredAt
  const quoteHtml = sanitizeStoredHtml(detail.bodyHtml ?? htmlFromText(detail.bodyText ?? ''))

  function openComposer(mode: 'reply' | 'forward'): void {
    if (!composer) return
    const replyToRecipients = detail.participants.filter((participant) => participant.role === 'reply_to')
    const recipients = mode === 'reply'
      ? (replyToRecipients.length > 0 ? replyToRecipients : detail.participants.filter((participant) => participant.role === 'from')).map((participant) => participant.address)
      : []
    void composer.openComposer({
      toAddrs: [...new Set(recipients)],
      subject: prefixedSubject(detail.subject, mode === 'reply' ? 'Re' : 'Fwd'),
      bodyHtml: `<p></p><blockquote>${quoteHtml}</blockquote>`,
    })
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-1 border-b border-border pb-4">
        <h3 className="text-sm font-semibold text-text">{detail.subject || '(no subject)'}</h3>
        {from && <p className="break-words text-xs text-text-muted"><span className="font-medium text-text">From:</span> {from}</p>}
        {replyTo && replyTo !== from && <p className="break-words text-xs text-text-muted"><span className="font-medium text-text">Reply to:</span> {replyTo}</p>}
        {to && <p className="break-words text-xs text-text-muted"><span className="font-medium text-text">To:</span> {to}</p>}
        {cc && <p className="break-words text-xs text-text-muted"><span className="font-medium text-text">Cc:</span> {cc}</p>}
        {date && <p className="text-xs text-text-muted">{formatDateTime(date, timeZone)}</p>}
      </section>

      <section aria-label="Email body" className="min-w-0 break-words text-text">
        {detail.bodyHtml ? <SanitizedHtml html={body.visible} className="tiptap text-sm" /> : <p className="whitespace-pre-wrap">{body.visible}</p>}
        {body.quote && (
          <details className="mt-3 border border-border bg-surface p-3">
            <summary className="cursor-pointer text-xs font-medium text-text-muted">Show trimmed content</summary>
            {detail.bodyHtml ? <SanitizedHtml html={body.quote} className="tiptap mt-3 text-sm" /> : <p className="mt-3 whitespace-pre-wrap text-sm text-text-muted">{body.quote}</p>}
          </details>
        )}
      </section>

      {detail.attachments.length > 0 && (
        <section aria-labelledby="email-attachments-heading" className="flex flex-col gap-2">
          <h3 id="email-attachments-heading" className="text-sm font-semibold">Attachments</h3>
          <ul className="divide-y divide-border border border-border">
            {detail.attachments.map((attachment) => (
              <li key={attachment.id} className="flex min-w-0 items-center justify-between gap-3 p-3">
                <span className="min-w-0 truncate">{attachment.filename || 'Attachment'}</span>
                <span className="shrink-0 text-xs text-text-muted">{formatBytes(attachment.sizeBytes) || attachment.contentType || (attachment.isStored ? 'Stored' : 'Unavailable')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {composer && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="button" size="sm" onClick={() => openComposer('reply')}>Reply</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => openComposer('forward')}>Forward</Button>
        </div>
      )}
    </div>
  )
}
