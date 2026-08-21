# Spec: `int-mailboxes`

> Module `int-mailboxes` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: `int-hub-ui`. Phase 5.

## Objective

A rep with two connected addresses picks **which one Maincar sends from**.

**Success looks like:** a rep who connected a personal and a work address sees both
listed, marks the work one primary, and the composer sends from it.

### Acceptance criteria

1. Each provider card lists only its own provider's mailboxes under the card
   header. One mailbox per address; Google rows never appear under Microsoft and
   Microsoft rows never appear under Google.
2. Exactly one mailbox per `(orgId, userId)` is **Primary**, across both providers.
   The flag is the composer's default sender.
3. Promoting a mailbox is **atomic** — there is never an instant with zero
   primaries, because the composer reads "no mailbox connected" during it.
4. The first mailbox a rep connects becomes primary automatically. A rep never has
   to know the concept exists to send their first email.
5. Removing the primary mailbox promotes the **most recently connected** remaining
   one. It never leaves the rep with mailboxes and no primary.
6. A rep can set a **display name** on a mailbox ("Work inbox"). It is theirs, not
   the provider's, and it is what the composer's sender picker shows.
7. Per-mailbox settings open in a drawer that is **deep-linkable** via
   `?mailbox=<id>`, so a link opens on that mailbox and the back button closes the
   drawer rather than leaving the page. It uses the existing
   `vite/src/hooks/urlState/` helpers.
8. Management actions on a mailbox row are an **icon toolbar with tooltips** —
   Settings, Test, Reconnect, Disconnect — not a stack of equal-weight buttons.
   Test sits after Settings and before Disconnect, and its per-capability result
   renders inside that mailbox's sub-card.
   Reconnect appears **only** when that mailbox needs it, so its presence is itself
   the signal.
9. Disconnect is a neutral icon that takes a destructive tint **on hover only**,
   never a filled destructive button. The confirm dialog is the real guard.
10. Every mailbox action is scoped to `(orgId, userId)`. A mailbox id from another
    rep returns 404, not someone else's mailbox.
11. Disconnecting a mailbox deletes its `OAuthConnection`; the cascade removes the
    mailbox and prevents an orphaned grant. If it was primary, the newest remaining
    mailbox is promoted in the same transaction.
12. **No sync control, no import-past-messages control, and no per-mailbox
    automation switch ships here.** Loadwire has all three. maincar-2 has no
    pipeline behind them, and a live-looking control that does nothing is what
    [CLAUDE.md](../../CLAUDE.md) forbids. They arrive with the sync initiative.

## Tech stack

React, React Query, existing shadcn components (`Sheet`, `Tooltip`, `AlertDialog`).
Express, Prisma, `zod`. **No new dependency.**

## Commands

Same as [`int-hub-ui`](SPEC-int-hub-ui.md#commands).

## Project structure

```
server/src/routes/mailboxes.ts                  → NEW. list, patch, primary, delete
server/src/lib/mail/mailAccounts.ts             → extend (created in int-schema)
server/src/app.ts                               → mount (edit, two lines)
server/src/routes/__tests__/mailboxes.test.ts   → NEW
vite/src/hooks/mailboxes/index.ts               → NEW. The barrel
vite/src/hooks/mailboxes/useGetMailboxes.ts     → NEW
vite/src/hooks/mailboxes/useSetPrimaryMailbox.ts → NEW
vite/src/hooks/mailboxes/useUpdateMailbox.ts    → NEW
vite/src/hooks/mailboxes/useDisconnectMailbox.ts → NEW
vite/src/pages/Settings_Integrations_MailboxRow.tsx     → NEW
vite/src/pages/Settings_Integrations_MailboxDrawer.tsx  → NEW
vite/src/pages/Settings_Integrations_ProviderCard.tsx   → render the list (edit)
vite/src/pages/Settings_Integrations_MailboxRow.test.tsx    → NEW
vite/src/pages/Settings_Integrations_MailboxDrawer.test.tsx → NEW
```

## API

```
GET    /api/mailboxes/orgs/:orgId
  200 { mailboxes: Mailbox[] }

PATCH  /api/mailboxes/orgs/:orgId/:mailboxId
  body { displayName?: string }
  200 { mailbox: Mailbox }

POST   /api/mailboxes/orgs/:orgId/:mailboxId/primary
  200 { mailboxes: Mailbox[] }        // the WHOLE list — one primary is a property
                                      // of the set, so the set is what comes back
DELETE /api/mailboxes/orgs/:orgId/:mailboxId
  200 { mailboxes: Mailbox[] }
```

```ts
export interface Mailbox {
  id: string
  provider: 'google' | 'microsoft'
  providerLabel: string
  emailAddress: string
  displayName: string | null
  isPrimary: boolean
  /** Mirrors the parent connection, so a row can show its own trouble. */
  status: 'connected' | 'limited' | 'error'
  statusDetail: string
  errorCode: IntegrationErrorCode | null
  lastValidatedAt: string | null
  connectionId: string
  connectedAt: string
}
```

`POST …/primary` returns the whole list rather than the one row, because "exactly
one is primary" is a property of the **set**. Returning one row would let the client
render two primaries between responses.

## Code style

```ts
// Disconnect the grant, not only the mailbox. The cascade removes the mailbox;
// the same transaction promotes the newest remaining row when the removed mailbox
// was primary.
await prisma.$transaction(async (tx) => {
  await tx.oAuthConnection.deleteMany({ where: { id: connectionId, orgId, userId } })
  const remaining = await tx.mailAccount.findFirst({
    where: { orgId, userId }, orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (remaining) {
    await tx.mailAccount.updateMany({ where: { orgId, userId }, data: { isPrimary: false } })
    await tx.mailAccount.updateMany({ where: { id: remaining.id }, data: { isPrimary: true } })
  }
})
```

```tsx
// The drawer's open state lives in the URL, not in useState, so the link is
// shareable and Back closes the drawer instead of leaving the page.
const [mailboxId, setMailboxId] = useUrlString('mailbox')
```

## Copy

| Where | String |
|---|---|
| Primary badge | `Primary` |
| Promote action | `Make primary` |
| Tooltip | `Open settings for {address}` / `Test {address}` / `Reconnect {address}` / `Disconnect {address}` |
| Drawer title | `{address}` |
| Display-name field | `Name this mailbox` |
| Display-name help | `Only you see this name.` |
| Disconnect dialog | `Disconnect {address}?` / `Maincar can no longer read or send from this address.` |
| Empty state | `Connect an account to send email from Maincar.` |

## Testing strategy

**Server**
- Promoting the second of two mailboxes leaves exactly one primary.
- **A promote and a concurrent promote of the other still leave exactly one.**
- Deleting the primary promotes the newest remaining one.
- Deleting the only mailbox leaves none, and no error.
- The first mailbox created is primary; the second is not.
- A `mailboxId` from another rep returns 404.
- A `mailboxId` from another org returns 404.
- `PATCH` with a 200-character display name is rejected with a named message.
- No response contains a token.

**Client**
- Two mailboxes render with exactly one `Primary` badge.
- Clicking "Make primary" on the non-primary moves the badge.
- Clicking Test probes that connection and renders the checkmarks in only its row.
- **Reconnect is absent on a healthy row and present on a `needs reconnect` row.**
- Disconnect opens the dialog and deletes nothing until confirmed.
- `?mailbox=<id>` opens the drawer on that mailbox on first render.
- Closing the drawer clears the param.
- An empty provider renders the empty state, not an empty list.

## Boundaries

**Always** — move the primary flag inside a transaction; return the whole list from
a primary change; scope every query to org and user; keep drawer state in the URL;
show Reconnect only when it is needed.
**Ask first** — shared or delegated mailboxes; more than one mailbox per address;
a per-mailbox automation switch.
**Never** — leave a rep with mailboxes and no primary; render a sync, import, or
automation control with no pipeline behind it; use `update({ where: { id } })` on a
mailbox.

## Success criteria

- [ ] All 12 acceptance criteria hold.
- [ ] A rep connects two addresses, promotes the second, and the composer's sender
      follows.
- [ ] `?mailbox=<id>` opens the drawer; Back closes it.
- [ ] Walked in both themes.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Is the primary mailbox per org or per rep across orgs? *(Recommendation: per
   `(org, rep)`. A rep in two orgs sends from a different address in each, and the
   unique constraint already says so.)*
