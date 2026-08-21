# Spec: `composer-send`

> Module `composer-send` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
> Depends on: `composer-dock`, `composer-recipients`, and **the separate OAuth
> project** ([SPEC-composer-mailbox.md](SPEC-composer-mailbox.md)). Phase 4.
>
> **BLOCKED.** Do not start this module until that project ships a working
> `getMailProvider()`. Until then the Send button stays visibly disabled with the
> label "Connect a mailbox in Settings → Integrations to send."

## Objective

The Send button becomes real. A rep presses it, the email leaves **their own
mailbox**, the card disappears, and a record of what was sent is kept.

maincar never shipped this — its Send button is honestly disabled to this day.
This module is what closes the loop.

**Success looks like:** a rep sends an email from maincar-2, the customer replies
to the rep's real address, and the rep can see what was sent and when.

### Acceptance criteria

1. Send is enabled only when there is a connected mailbox **and** at least one
   valid To address. Disabled, it names which of the two is missing.
2. Every address is validated for **deliverability** here — the one place it
   happens. A malformed address blocks the send and is named in the message.
3. Merge fields are resolved by the **same** function the preview uses — *once
   merge fields exist. They are deferred with the CRM port
   ([SPEC-composer-body.md](SPEC-composer-body.md) § Deferred, which waits on
   [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md)). If this module
   ships first, the body is sent as stored and criterion 4 does not apply yet.*
4. If any merge field is missing — no value and no fallback — the rep gets a
   confirm dialog naming the fields before anything is sent. They can proceed.
5. On success the card closes, the draft row is deleted, and a toast says the
   email was sent.
6. On failure the card **stays open with everything intact**, and the toast says
   what went wrong in words the rep can act on.
7. A send is idempotent per attempt: a double-click sends one email.
8. The sent email is stored as an `EmailMessage` row with its provider message
   id, thread id, and the sent timestamp.
9. Sent-at renders in the **viewing user's** timezone with an explicit zone label
   (CLAUDE.md → Dates & Times), through `lib/datetime.ts`.
10. The body is sanitised on the server before it is handed to the provider —
    never trust that the client did it.
11. A recipient cap (100 across To + Cc + Bcc) is enforced server-side.

## Tech stack

Express, Prisma, `zod`, `sanitize-html`. Sending goes through
`composer-mailbox`'s `MailProvider`. **No new client dependencies.**

## Commands

Same as [`composer-dock`](SPEC-composer-dock.md#commands).

## Project structure

```
server/prisma/schema.prisma            → add EmailMessage
server/src/routes/email.ts             → add POST .../drafts/:draftId/send
server/src/lib/mail/sendEmail.ts       → NEW. Validate → resolve → sanitise → send → record
server/src/lib/mail/__tests__/sendEmail.test.ts → NEW
vite/src/components/composer/ComposerCard.tsx   → Send becomes live
vite/src/components/composer/ComposerCard_SendConfirm.tsx → NEW. Missing-fields dialog
vite/src/hooks/email/useSendEmailDraft.ts       → NEW
```

## API

`POST /api/email/orgs/:orgId/drafts/:draftId/send`

The route takes the **draft id**, not a payload. The server reads the draft it
already owns, so what is sent is exactly what was autosaved — there is no second
copy of the truth and no window where the body in flight differs from the body on
screen.

```ts
// 200
{ message: { id, providerMsgId, threadId, sentAt } }

// 409 — no mailbox connected
{ error: 'Connect a mailbox in Settings → Integrations to send.', code: 'no_mailbox' }

// 400 — a recipient the provider will reject
{ error: 'This is not a valid email address: ann@', code: 'bad_recipient' }

// 502 — the provider refused
{ error: 'Gmail would not accept the message. Nothing was sent.', code: 'provider_error' }
```

Every failure leaves the draft row **untouched**. Deleting the draft is the last
step of a successful send, never the first step of an attempt.

## Data model

```prisma
model EmailMessage {
  id            String   @id @default(cuid())
  org           Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId         String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId        String
  mailAccountId String
  // The provider's own ids, so a later sync can match this to the thread rather
  // than creating a duplicate of an email we ourselves sent.
  providerMsgId String
  threadId      String?
  direction     String   // outbound — inbound arrives with mail sync
  fromAddr      String
  toAddrs       String[]
  ccAddrs       String[]
  bccAddrs      String[]
  subject       String?
  // The RESOLVED body, as sent. Never the template. What the customer received is
  // what we keep, or the record and the reality disagree.
  bodyHtml      String?
  sentAt        DateTime
  createdAt     DateTime @default(now())

  @@unique([mailAccountId, providerMsgId])
  @@index([orgId, userId, sentAt])
}
```

## Code style

```ts
// The order is load-bearing. Resolve BEFORE sanitise, so a merge value that
// contains markup is escaped by the resolver and then cleaned by the sanitiser —
// two independent defences, in that order.
const resolved = resolveMergeFields(draft.bodyHtml ?? '', values, { escapeHtml: true })
const clean = sanitizeHtml(resolved.text)
const sent = await provider.sendEmail({ to, cc, bcc, subject, bodyHtml: clean })

// Record first, delete second. A crash between them leaves a sent email with a
// stale draft — annoying. The other order loses the record of a real email — not.
await prisma.emailMessage.create({ data: { ...sent, ... } })
await prisma.emailDraft.deleteMany({ where: { id: draftId, orgId, userId } })
```

The stored `bodyHtml` and the sent `bodyHtml` are the **same string**. Never
compute a user-facing value after the fact and store a different one than went
out (CLAUDE.md → AI drafting).

## Testing strategy

The provider is mocked. No test sends a real email.

- Send with no mailbox → 409, draft untouched.
- Send with `to: []` → 400, draft untouched.
- Send with `"ann@"` in To → 400 naming that address, draft untouched.
- A successful send creates exactly one `EmailMessage` and deletes the draft.
- A provider throw → 502, and the draft still exists with its body intact.
- Two concurrent sends of the same draft produce **one** `EmailMessage`.
- The resolved body contains no `{{`.
- A merge value of `<script>` arrives at the provider escaped.
- 101 recipients → 400.
- Another member's draft id → 404.

**Client**
- Send disabled with no mailbox, and the label names that reason.
- Missing merge fields open the confirm dialog before any request fires.
- A failed send leaves the card open with its text.

**Verify in a browser, end to end:** connect a real mailbox in the emulator
environment, send one email to yourself, and confirm it arrives from your own
address. Nothing short of that proves this module works.

## Boundaries

**Always** — validate deliverability here; sanitise on the server; resolve with
the shared resolver; record before deleting; leave the draft alone on any failure.
**Ask first** — attachments; scheduled send; sending to more than 100 recipients;
any bulk or sequence send, which is a different feature with different consent
rules.
**Never** — send from a shared or system address instead of the rep's own; retry
a send automatically after an ambiguous failure (a duplicate email to a customer
is worse than an error message); log a message body; ship a Send button that is
enabled before this module is done.

## Success criteria

- [ ] All 11 acceptance criteria hold.
- [ ] A real email sent from a real connected mailbox arrives, from the rep's
      own address, with merge fields filled in.
- [ ] Every failure path leaves the draft recoverable.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Where does a rep see what they have sent — a Sent page, or the record
   timeline? *(Recommendation: neither in this module. Store the rows, ship the
   read surface separately, and do not render a Sent nav item that goes nowhere.)*
2. Should send be queued (pg-boss) or synchronous? *(Recommendation: synchronous.
   A rep pressing Send wants to know now whether it went, and a queue turns a
   400 into a silent failure.)*
