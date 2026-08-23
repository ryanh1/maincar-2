// MailProvider.ts — THE SEAM. The one interface every caller sends mail, reads
// mail, and reads/writes calendar events through, never learning which provider
// is underneath (SPEC-int-seam.md § The seam).
//
// PUBLISHED CONTRACT. These five method signatures and the types crossing them
// are the contract the Email Composer Dock project codes against
// (docs/specs/SPEC-composer-mailbox.md). They are ADDED TO, never renamed:
// `getMailProvider(mailAccountId, orgId)` hands one of these back, and
// `composer-send` calls `sendEmail` on it. A rename here breaks that project.
//
// TIME. Every `Date` crossing this seam is an absolute instant in UTC. Formatting
// for a human — a zone label, a rep's timezone — happens at the edge, never here
// (CLAUDE.md → Dates & Times). An implementation that reads a provider's local or
// wall-clock time converts it to UTC before it returns.
//
// PAGING. `listMessagesSince` and `listEventsSince` are CURSOR-based, never
// offset-based: they take an opaque cursor (Gmail `historyId`, Graph `deltaLink`)
// and return the next page plus `nextCursor`. An offset would silently skip or
// double-count messages that arrived mid-scan; a cursor the provider has expired
// throws `CursorExpiredError` (mailErrors.ts) so a caller restarts cleanly.
//
// NO IMPLEMENTATION. This file declares types and one interface. It imports no
// provider SDK and contains no logic — the two implementations (googleMail,
// microsoftMail) and the shared contract suite live in their own files.

/** A single mail participant. `name` is the display name when the provider gives one. */
export type MailAddress = { name?: string; email: string }

/**
 * A message the caller is asking a provider to send. `bodyHtml` is already
 * sanitized by the caller — this seam does not sanitize. `bcc` recipients are put
 * in the envelope by the implementation and never in a visible header.
 */
export type OutboundEmail = {
  to: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  subject: string
  bodyHtml: string // already sanitized by the caller
  inReplyToMessageId?: string
  threadId?: string
  attachments?: { filename: string; contentType: string; contentBase64: string }[]
}

/**
 * The receipt for a sent message. `sentAt` is THE PROVIDER'S timestamp for the
 * send — read back from the provider's response — never `new Date()` computed
 * locally. The stored record and anything a model later states about "when this
 * was sent" must agree with the provider, so the value comes from the provider.
 */
export type SentEmail = { providerMsgId: string; threadId: string; sentAt: Date }

/**
 * The provider accepted the send, but did not return a stored message receipt.
 * Microsoft Graph's `POST /me/sendMail` is this shape: it returns 202 Accepted
 * with no response body. See https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0#response
 */
export type AcceptedEmail = { kind: 'accepted' }

/** A provider either returns a real receipt or explicitly says it only accepted the request. */
export type SendEmailResult = SentEmail | AcceptedEmail

/**
 * A message read back from a mailbox. The rep's own sent mail comes back through
 * here too, flagged with `isOutbound`. `sentAt` is UTC.
 */
export type InboundMessage = {
  providerMsgId: string
  threadId: string | null
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  sentAt: Date
  isOutbound: boolean // the rep's own sent mail comes back through here too
}

/** A calendar event read from or written to a rep's calendar. `startsAt`/`endsAt` are UTC. */
export type CalendarEvent = {
  providerEventId: string
  title: string | null
  description: string | null
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  attendees: MailAddress[]
  organizer: MailAddress | null
}

/**
 * The seam. One implementation per provider, both passing the same shared contract
 * suite. A caller depends on this interface and never on which provider backs it.
 *
 * The read methods (`listMessagesSince`, `getMessage`, `listEventsSince`) and
 * `createEvent` are real, typed capability: SPEC-int-seam.md § acceptance 10 has
 * them built and tested, with nothing in the app calling them on a schedule. The
 * sync initiative consumes them later and needs no change here.
 */
export interface MailProvider {
  readonly provider: 'google' | 'microsoft'
  sendEmail(input: OutboundEmail): Promise<SendEmailResult>
  listMessagesSince(
    cursor: string | null,
    limit: number,
  ): Promise<{ messages: InboundMessage[]; nextCursor: string | null }>
  getMessage(providerMsgId: string): Promise<InboundMessage>
  /** A filtered historical page used only by the first-connect import. */
  listBackfillMessages(
    cursor: string | null,
    limit: number,
    since: Date,
  ): Promise<{ messages: InboundMessage[]; nextCursor: string | null }>
  listBackfillEvents(
    cursor: string | null,
    limit: number,
    since: Date,
  ): Promise<{ events: CalendarEvent[]; nextCursor: string | null }>
  listEventsSince(
    cursor: string | null,
    limit: number,
  ): Promise<{ events: CalendarEvent[]; nextCursor: string | null }>
  createEvent(input: Omit<CalendarEvent, 'providerEventId' | 'organizer'>): Promise<CalendarEvent>
}
