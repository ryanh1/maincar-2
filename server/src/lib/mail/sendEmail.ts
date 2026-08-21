// sendEmail.ts — composer-send's orchestration (docs/specs/SPEC-composer-send.md).
//
// Validate deliverability → resolve the sending mailbox → sanitise → send →
// record, in that order. Every step before "send" throws without touching the
// draft; nothing here writes until the provider has confirmed the message went.
//
// THE RECORD. The spec proposed a dedicated `EmailMessage` model before `Email`
// (MAI-137's CRM activity table) existed. `Email` is now the superset that model
// would have duplicated — the same provider bookkeeping, `EmailParticipant` rows
// instead of flat address arrays, and the Company/Deal roll-ups the CRM feed
// already reads a sent message through. A sent draft becomes one `Email` row with
// `direction: 'outbound'`, not a second table next to it.
import { randomUUID } from 'node:crypto'

import prisma from '../../db.js'
import { EMAIL_RE } from '../../crm/valuesValidator.js'
import { sanitizeRichTextHtml } from '../sanitizeHtml.js'
import { getMailProvider } from './getMailProvider.js'
import type { MailAddress } from './MailProvider.js'
import type { EmailDraft } from '../../generated/prisma/client.js'

/** Across To + Cc + Bcc together (SPEC § Acceptance criteria, 11). */
export const MAX_SEND_RECIPIENTS = 100

/** No mailbox to send from — no `mailAccountId` on the draft, and no primary either. */
export class NoMailboxError extends Error {
  constructor(message = 'Connect a mailbox in Settings → Integrations to send.') {
    super(message)
    this.name = 'NoMailboxError'
  }
}

/** A recipient the provider would reject, or none at all. Names the address when there is one. */
export class BadRecipientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRecipientError'
  }
}

/** The receipt handed back to the route: what changed, and what to tell the rep. */
export interface SentDraft {
  id: string
  providerMsgId: string
  threadId: string | null
  sentAt: Date
}

function toMailAddress(address: string): MailAddress {
  return { email: address }
}

// `Email.provider` names the sync-source convention this table already uses
// (gmail | m365 | imap, server/src/crm/emailActivity.ts → EMAIL_PROVIDERS).
// `MailAccount.provider` names the seam instead ('google' | 'microsoft',
// getMailProvider.ts's own switch). This is the one place a value crosses from
// one convention to the other.
function toEmailProvider(mailAccountProvider: string): string {
  return mailAccountProvider === 'microsoft' ? 'm365' : 'gmail'
}

/**
 * Send one draft on behalf of `userId` in `orgId`, and delete it on success.
 *
 * The caller (the route) has already loaded `draft` scoped to `(id, orgId,
 * userId)` — this function trusts that scoping and does not repeat it, except
 * for the mailbox lookup below, which carries the same two keys itself.
 */
export async function sendDraftEmail(
  orgId: string,
  userId: string,
  draft: EmailDraft,
): Promise<SentDraft> {
  // --- Validate deliverability ---
  // The one place it happens (SPEC § Acceptance criteria, 2) — autosave checks
  // shape only, because "ann@" is what a rep mid-word has, and refusing to save
  // it would lose the keystroke.
  const toAddrs = draft.toAddrs
  const ccAddrs = draft.ccAddrs
  const bccAddrs = draft.bccAddrs
  const allAddrs = [...toAddrs, ...ccAddrs, ...bccAddrs]

  if (toAddrs.length === 0) {
    throw new BadRecipientError('Add a recipient to send.')
  }
  if (allAddrs.length > MAX_SEND_RECIPIENTS) {
    throw new BadRecipientError(`A message can have at most ${MAX_SEND_RECIPIENTS} recipients.`)
  }
  for (const address of allAddrs) {
    if (!EMAIL_RE.test(address)) {
      throw new BadRecipientError(`This is not a valid email address: ${address}`)
    }
  }

  // --- Resolve the sending mailbox ---
  // There is no mailbox picker in the composer yet, so a draft that never set
  // one sends from the rep's primary connected mailbox — "their own mailbox",
  // the way the spec's Objective puts it, and exactly one per (org, rep) is
  // ever primary (schema.prisma → MailAccount).
  const mailAccount = draft.mailAccountId
    ? await prisma.mailAccount.findFirst({ where: { id: draft.mailAccountId, orgId, userId } })
    : await prisma.mailAccount.findFirst({ where: { orgId, userId, isPrimary: true } })
  if (!mailAccount) {
    throw new NoMailboxError()
  }

  // --- Sanitise ---
  // Never trust that the client did it, or that the autosave that stored this
  // body ran through every code path since — sanitising again here is what
  // makes "the stored bodyHtml is safe" true rather than merely likely.
  const bodyHtml = sanitizeRichTextHtml(draft.bodyHtml ?? '')
  const subject = draft.subject ?? ''

  // --- Send ---
  const provider = await getMailProvider(mailAccount.id, orgId)
  const sent = await provider.sendEmail({
    to: toAddrs.map(toMailAddress),
    cc: ccAddrs.length > 0 ? ccAddrs.map(toMailAddress) : undefined,
    bcc: bccAddrs.length > 0 ? bccAddrs.map(toMailAddress) : undefined,
    subject,
    bodyHtml,
  })

  // --- Record, then delete ---
  // Record first, delete second: a crash between them leaves a sent email with
  // a stale draft, which is a rep re-sending by mistake — annoying but
  // recoverable. The other order loses the record of a real email — not.
  //
  // A synthetic RFC5322 Message-ID: this message never had one until we minted
  // it, and the unique constraint on (orgId, mailAccountId, internetMessageId)
  // needs a value (schema.prisma → Email).
  const internetMessageId = `<${randomUUID()}@maincar>`
  const email = await prisma.email.create({
    data: {
      orgId,
      mailAccountId: mailAccount.id,
      direction: 'outbound',
      subject,
      // The RESOLVED body, as sent. Never a second value computed after the
      // fact — the stored bodyHtml and the sent bodyHtml are the same string
      // (CLAUDE.md → AI drafting).
      bodyHtml,
      internetMessageId,
      conversationId: sent.threadId,
      isRead: true,
      isDraft: false,
      provider: toEmailProvider(mailAccount.provider),
      providerMessageId: sent.providerMsgId,
      providerThreadId: sent.threadId,
      sentAt: sent.sentAt,
      participants: {
        create: [
          { orgId, role: 'from', address: mailAccount.emailAddress },
          ...toAddrs.map((address) => ({ orgId, role: 'to', address })),
          ...ccAddrs.map((address) => ({ orgId, role: 'cc', address })),
          ...bccAddrs.map((address) => ({ orgId, role: 'bcc', address })),
        ],
      },
    },
  })

  await prisma.emailDraft.deleteMany({ where: { id: draft.id, orgId, userId } })

  return { id: email.id, providerMsgId: sent.providerMsgId, threadId: sent.threadId, sentAt: sent.sentAt }
}
