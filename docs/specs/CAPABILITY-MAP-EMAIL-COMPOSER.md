# Capability Map: Gmail-style Email Composer (maincar → maincar-2)

Port Maincar's composer dock into maincar-2. The dock is a **bottom-bar widget**:
cards rise from the bottom-right corner, sit above every route, and survive
navigation and refresh.

**Decisions taken (2026-08-20, Ryan):**

1. **Wait for the contacts database.** Recipient autocomplete and merge fields
   both read CRM people, and maincar-2 has no CRM yet — only a proposal, [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md)
   (`Person`, `ContactEmail`, `Company`). Neither is built now. Both are specified
   in full, marked *Deferred — blocked on the CRM schema*, so they land as data and
   wiring rather than as a redesign.
2. **TipTap for the editor.** Rich text ships in this initiative.
3. **Gmail only, and the mailbox OAuth is a separate project**, starting next.
   `composer-mailbox` is therefore **out of scope here** — its spec in this folder
   is the handoff brief for that project, and `composer-send` waits on it.

Reference implementation lives in `maincar` (the previous repo):

| maincar file | What to read it for |
|---|---|
| `vite/src/components/composer/ComposerDock.tsx` | Dock layout, overflow-to-chip rule |
| `vite/src/components/composer/ComposerProvider.tsx` | Above-the-router state, `c` hotkey, hydration merge |
| `vite/src/components/composer/ComposerCard.tsx` | One card, autosave debounce, caret rule |
| `vite/src/components/composer/ComposerCard_Recipients.tsx` | Chip fields, backspace-deletes-chip |
| `server/src/routes/email-drafts.ts` | Draft CRUD, private-to-author rule |
| `server/src/routes/email-recipients.ts` | Tiered autocomplete (deferred here) |
| `server/src/lib/mail/mergeFields.ts` | Merge-field resolver (deferred here) |
| `server/src/lib/mail/MailProvider.ts` | The Gmail/Graph seam (separate project) |

## Module dependencies

| Module id | Responsibility | Depends on | Status |
|---|---|---|---|
| `composer-dock` | Bottom-bar dock, cards, minimize/close/discard, autosave, `EmailDraft` model | — | **Build now** — foundational |
| `composer-recipients` | To / Cc / Bcc chip fields, typed addresses, backspace delete | `composer-dock` | **Build now** — autocomplete deferred |
| `composer-body` | Subject line and rich-text body editor | `composer-dock` | **Build now** — merge fields deferred |
| `composer-templates` | Saved email templates, insert into a card | `composer-body` | **Build now** — enhancement |
| `composer-mailbox` | Connect a Gmail mailbox, the `MailProvider` seam | — | **Out of scope.** Separate OAuth project, starting next |
| `composer-send` | Validate, send, record the sent message | `composer-dock`, `composer-recipients`, **the OAuth project** | **Blocked** until that project ships |

No cycles. `composer-recipients` and `composer-body` can be built in parallel.

## Build order

**Phase 1:** `composer-dock`
**Phase 2 (parallel):** `composer-recipients` + `composer-body`
**Phase 3:** `composer-templates`
**Phase 4:** `composer-send` — **starts only after the separate OAuth project ships a working `MailProvider`**

**Deferred, blocked on the CRM schema** ([SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md) — not a phase; they
attach to modules that already exist by then):
- recipient autocomplete → `SPEC-composer-recipients.md` § Deferred
- merge fields and preview → `SPEC-composer-body.md` § Deferred
- merge fields inside templates → `SPEC-composer-templates.md` § Deferred

Phase 1 is shippable on its own: a rep can open a card, type, close it, and find
the draft where they left it. Through Phase 3 the composer **cannot send**, so
the Send button renders **visibly disabled with an honest label** the whole time —
the same rule maincar followed (CLAUDE.md → "Never leave a feature half-wired").
That is a long stretch with a dead Send button. It is still the right call: the
alternative is a live-looking control with no mailbox behind it.

## Module scope (one sentence each)

- **composer-dock**: A rep presses `c` or clicks Compose, a card rises from the bottom bar, and everything typed into it is still there after a refresh.
- **composer-recipients**: A rep types an address, presses Enter, and gets a chip that one Backspace removes whole.
- **composer-body**: A rep writes formatted text with bold, lists, and links.
- **composer-templates**: A rep saves an email they send often and inserts it into any card without losing the recipients.
- **composer-mailbox** *(separate project)*: A rep connects their work Gmail once, in Settings, and the app can send as them.
- **composer-send** *(blocked)*: A rep presses Send, the email leaves their own mailbox, and the card disappears.

## Key interfaces (module boundaries)

- **composer-dock → everything**: `useComposer()` context — `openComposer()`, `saveDraft()`, `closeCard()`, `discardDraft()`. Every other module renders *inside* a card and reads this.
- **composer-recipients → composer-send**: a chip is `{ address, displayName, recordId }`. `recordId` is null for every chip until the CRM lands, and that is fine — the field carries it from day one so nothing changes shape later.
- **composer-body → composer-send**: the body is stored HTML. When merge fields arrive they are stored as literal `{{field}}` / `{{field | fallback}}` text inside that same HTML — one storage format, resolved by one shared function at both preview and send.
- **OAuth project → composer-send**: `getMailProvider(mailAccountId)` returns a `MailProvider` with `sendEmail(OutboundEmail): Promise<SentEmail>`. No caller ever branches on `provider === 'google'`. **This signature is the contract between the two projects** — see `SPEC-composer-mailbox.md`.
- **composer-templates → composer-body**: inserting a template replaces subject and body, and **keeps** the recipients.

## Assumptions (review these before approving)

1. **maincar-2 is much earlier than maincar.** It has `Org`, `User`, `Membership`, `Invitation`, `PhoneNumber`, `Call`. It has **no CRM tables**, **no** `MailAccount` / `OAuthConnection`, and **no** rich-text editor. [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md) is a proposal, not approved and not built — every deferred item below waits on it, specifically on `Person` and `ContactEmail`.
2. **Terminology is `Org`, not `Workspace`.** Every maincar route path `/workspaces/:workspaceId/...` becomes `/api/email/orgs/:orgId/...`. Every column is `orgId`.
3. **A draft is private to its author.** Org-scoped *and* user-scoped. Another member's draft is a **404**, never a 403 — a 403 confirms it exists.
4. **Multiple cards at once**, Gmail-style, capped at 12 open per rep.
5. **Autosave only.** There is no "Save draft" button. The card saves 1200 ms after the last keystroke.
6. **Closing ≠ discarding.** The `X` closes the card and keeps the draft. Only the trash icon, behind an `AlertDialog`, deletes anything.
7. **The dock reserves the dialer's corner.** `SPEC-DIALER-REBUILD.md` puts a dialer in the bottom-right. The composer stacks leftwards from a reserved 368 px, whether the dialer is open or shut, so a card never slides out from under the cursor.
8. **Send is real, not simulated.** There is no fallback SMTP and no transactional-email provider standing in.
9. **Nothing in this initiative spends money.** Gmail sending is free within the user's own quota. If that changes, ask in the turn the spend would happen (CLAUDE.md → Money).

## Open questions

1. **Where does Compose live?** maincar had only the `c` hotkey. maincar-2's `Sidebar.tsx` has room for a primary **Compose** button. *(Recommendation: add it — a hotkey alone is undiscoverable.)*
2. **Mobile.** The dock is desktop-shaped. Below `lg`, hide it entirely, or open the composer full-screen? *(Recommendation: hide it below `lg` and say so, rather than ship a 384 px card on a 375 px phone.)*
