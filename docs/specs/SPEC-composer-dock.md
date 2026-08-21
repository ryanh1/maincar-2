# Spec: `composer-dock`

> Module `composer-dock` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
> Depends on: nothing. Phase 1.

## Objective

A rep is on any screen in maincar-2. They press `c`, or click **Compose**. A card
rises from the bottom-right corner, above whatever they were looking at. They
type. They navigate to another page — the card is still there, still holding what
they typed. They close the browser and come back tomorrow — the draft is in the
dock's **Drafts** button, exactly as they left it.

That is the whole module. It looks and behaves like Gmail's compose window.

**User:** any signed-in member of an org.

**Success looks like:** a rep never loses a half-written email, and never has to
leave the page they are on to write one.

### Acceptance criteria

1. Pressing `c` anywhere outside a text field opens a new card. Pressing `c`
   inside an input, textarea, select, or contenteditable types the letter `c`.
2. A card renders 384 px wide (`w-96`), 416 px tall (`h-[26rem]`), anchored to the
   bottom edge with no gap beneath it, exactly like Gmail.
3. Up to 12 cards can be open per rep. Newest sits rightmost.
4. When the window is too narrow to fit every expanded card beside the reserved
   dialer corner, the **oldest** cards collapse to chips first.
5. `−` minimizes a card to a 32 px title-bar chip. Clicking the chip restores it.
6. `X` closes the card and **keeps** the draft. The dock shows a `Mail` button
   reading "3 drafts"; clicking it reopens the most recently closed one.
7. The trash icon opens an `AlertDialog`. Only confirming there deletes anything.
8. Everything typed is saved 1200 ms after the last keystroke. Minimizing,
   closing, or discarding flushes the pending save first.
9. A full page refresh restores the dock — the same cards, the same minimized
   states, the same text.
10. The body editor's caret **never** moves because a save came back. The card
    owns its own text while open and never re-reads its own saved value.
11. Switching orgs empties the dock and loads that org's drafts.
12. The **Send** button renders visibly disabled with the label
    "Connect a mailbox in Settings → Integrations to send." until `composer-send`
    lands. It is never a live-looking control that does nothing.

## Tech stack

- React 19, `react-router-dom` 7, TanStack Query 5, Tailwind 4, `sonner`, `lucide-react`
- Express 5, Prisma, PostgreSQL, `zod`
- Existing primitives only: `components/ui/button.tsx`, `alert-dialog.tsx`,
  `dropdown-menu.tsx`, `tooltip.tsx`, `input.tsx`
- **No new dependencies in this module.** (The editor's are `composer-body`'s.)

## Commands

```bash
npm run dev                 # Vite + Express together, from the repo root
npm run typecheck           # tsc -b --noEmit, both packages
npm run lint                # ESLint
npm test                    # vitest run, both packages
npm run db:migrate          # prisma migrate dev, after the schema change below
docker compose up -d        # local Postgres, from docker/
```

## Project structure

```
server/
  prisma/schema.prisma              → add model EmailDraft
  src/routes/email.ts               → NEW. Draft CRUD, mounted at /api/email
  src/routes/__tests__/email.test.ts → NEW. Supertest coverage of the four routes
  src/app.ts                        → mount: app.use('/api/email', emailRouter)

vite/src/
  components/composer/
    ComposerDock.tsx                → NEW. The bottom bar itself
    ComposerCard.tsx                → NEW. One card
    ComposerProvider.tsx            → NEW. State, mounted ABOVE <Outlet />
    ComposerDock.test.tsx           → NEW
    ComposerCard.test.tsx           → NEW
  components/ProtectedLayout.tsx    → wrap children in <ComposerProvider>, render <ComposerDock />
  hooks/email/
    index.ts                        → NEW barrel (CLAUDE.md → Hooks Organization)
    types.ts                        → NEW. EmailDraft, EmailDraftInput
    useGetEmailDrafts.ts
    useCreateEmailDraft.ts
    useUpdateEmailDraft.ts
    useDeleteEmailDraft.ts
  lib/queryKeys.ts                  → add the `email` branch
```

## Data model

```prisma
model EmailDraft {
  id            String   @id @default(cuid())
  org           Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId         String
  // The rep writing it. A draft is private to its author, so every read and every
  // write filters on userId as well as orgId. Another member's draft is a 404.
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId        String
  // The mailbox this will go out on. Null until composer-mailbox lands.
  mailAccountId String?
  // The record the composer was opened from, so reopening lands back in context.
  // Null until the CRM port lands. Deliberately a bare String, not a relation.
  recordId      String?
  toAddrs       String[]
  ccAddrs       String[]
  bccAddrs      String[]
  subject       String?
  bodyHtml      String?
  // Dock state, so a refresh restores the corner exactly as the rep left it.
  //
  // Two flags, not one, because Gmail's X and its − are different acts. isOpen
  // false means the card is out of the dock but the draft is KEPT — closing an
  // email has never meant throwing it away. isMinimized means the card is still
  // in the dock, collapsed to a chip. Discarding is a DELETE, and nothing else is.
  isOpen        Boolean  @default(true)
  isMinimized   Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // The dock's only query: this rep's drafts in this org, newest edit first.
  @@index([orgId, userId, updatedAt])
}
```

## API

All four require auth and resolve the org from `:orgId`, verified through the
same `requireMembership` helper `routes/team.ts` uses.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/email/orgs/:orgId/drafts` | Every draft this rep has here, open and closed, oldest first. Max 200. |
| `POST` | `/api/email/orgs/:orgId/drafts` | Open a card. Creates the row **empty and immediately**, so autosave is always a PATCH against an id that exists. 409 past 12 open. |
| `PATCH` | `/api/email/orgs/:orgId/drafts/:draftId` | Autosave. Writes only the keys present in the body. |
| `DELETE` | `/api/email/orgs/:orgId/drafts/:draftId` | Discard. Behind an `AlertDialog` on the client. |

Two rules shape every handler:

1. **Both filters, always.** `where: { id, orgId, userId }`. Write with
   `updateMany` / `deleteMany` and treat `count === 0` as a 404 — never
   `update({ where: { id } })`, which ignores the org.
2. **The write path is dumb.** Autosave fires while the rep is typing. Store what
   you are given and return the stored row. Never reformat the body: the editor
   would be re-rendered from the response mid-keystroke and the caret would jump.

Addresses are validated for **shape, not deliverability** —
`z.string().trim().min(1).max(320)`, in an array capped at 100. A strict
`.email()` here would reject the recipient the rep is halfway through typing.
Deliverability is checked once, at send, in `composer-send`.

## Visual spec (the Gmail look)

Read [design-system.md](../../.claude/rules/design-system.md) first. Every colour
below is a token — no hex, no Tailwind palette colour.

```
                                              ┌── reserved for the dialer ──┐
┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐              
│ 📧 3 drafts  │  │ ✏ Re: Quote  │  │ Re: Quote — ann@ac  − ✕│ ← h-8 header 
└──────────────┘  └──────────────┘  ├────────────────────────┤              
   kept-drafts       minimized      │ To   [Ann Lee ✕] [+]   │              
     button            chip         │              Cc/Bcc    │              
                                    │ Re   Subject           │              
                                    ├────────────────────────┤              
                                    │ Write a message        │              
                                    │                        │ ← flex-1     
                                    ├────────────────────────┤              
                                    │ 📄 👁  [Send]      🗑  │ ← footer     
                                    └────────────────────────┘              
  ──────────────────────────────────────────────────────────── bottom edge
```

| Thing | Value |
|---|---|
| Card | `w-96 h-[26rem] rounded-t-md border border-border bg-background shadow-md` — **no bottom radius, no bottom gap**, it grows out of the bottom edge |
| Card header | `h-8 bg-muted border-b border-border px-2`, title `text-sm font-semibold truncate` |
| Minimized chip | `h-8 w-56 rounded-t-md border border-b-0 border-border bg-card` |
| Row of fields | each `border-b border-border px-3`, label `w-8 text-xs font-medium text-muted-foreground` |
| Footer | `border-t border-border px-3 py-2`, icon buttons `h-8 w-8 rounded-md` |
| Icons | `lucide-react` at `size={16}`: `Minus`, `X`, `FileText`, `Eye`, `Trash2`, `Mail`, `Pencil` |
| Gap between cards | `gap-3` (12 px) |
| Dock | `fixed bottom-0 z-40`, `right: 368px`, `pointer-events-none` on the strip and `pointer-events-auto` on the cards |
| Dialer reserve | **368 px** = the dialer's 320 px card + its 24 px right margin + a 24 px gap. Reserved whether the dialer is open or shut. |
| Card slot | **396 px** = `w-96` (384) + `gap-3` (12) |
| Minimum dock width | **240 px** before everything becomes a chip |

Title-bar text, in order of preference: `"{subject} — {first recipient}"`, then
the subject alone, then the first recipient alone, then `"New message"`.

Copy follows [copy.md](../../.claude/rules/copy.md): sentence case, no
exclamation marks, and a disabled control always says why.

## Code style

The three rules this module lives or dies by, as they appear in the code:

```tsx
// 1. The card owns its own text. It reports upward on a debounce and NEVER
//    re-reads its own saved value — re-rendering the editor from a save response
//    moves the caret mid-sentence. This is the single most important rule here.
const first = useRef(true)
useEffect(() => {
  if (first.current) { first.current = false; return }   // opening ≠ editing
  const timer = setTimeout(() => saveDraft(draft.id, pending), AUTOSAVE_DELAY_MS)
  return () => clearTimeout(timer)
}, [pending, draft.id, saveDraft])

// 2. The first load MERGES rather than replaces. A rep can press `c` before the
//    list comes back; a plain assignment would wipe the card they just opened.
setDrafts((current) => {
  const mine = new Set(current.map((d) => d.id))
  return [...data.drafts.filter((d) => !mine.has(d.id)), ...current]
})

// 3. Closing is a save, not a delete. Only discardDraft() removes anything.
const closeCard = useCallback(
  (draftId: string) => saveDraft(draftId, { isOpen: false }),
  [saveDraft],
)
```

Conventions, all from CLAUDE.md and its rule files:
- Comments say **why**, not what. Every non-obvious constant carries its reason.
- Query keys come from `lib/queryKeys.ts`. Never inline a key array.
- Every hook lives in `hooks/email/` behind the `index.ts` barrel.
- `jsonFetch` for every call. Never `axios`, never bare `fetch`.
- Named exports. No default exports on components.
- Timestamps render through `lib/datetime.ts` with an explicit zone label. The
  dock shows none today; if one is added, that is where it comes from.

## Testing strategy

`vitest` + `@testing-library/react` on the client, `vitest` + `supertest` on the
server. Client tests sit beside the component; server tests in
`src/routes/__tests__/`.

**Server — `email.test.ts`**
- `POST` creates an empty draft owned by the caller, returns 201.
- `POST` returns 409 on the 13th open draft.
- `PATCH` with only `{ isMinimized: true }` leaves `bodyHtml` untouched.
- `PATCH` and `DELETE` on another member's draft return **404**, not 403.
- `PATCH` and `DELETE` with a valid id but a different `orgId` return 404.
- `GET` returns closed drafts as well as open ones.
- An address of 321 characters is a 400; an address that is not an email
  (`"ann@"`) is accepted, because the rep is still typing it.

**Client**
- `c` opens a card; `c` while focused in an input does not.
- Typing then waiting past the debounce fires exactly one PATCH.
- Minimize flushes the pending save **before** it collapses.
- `X` fires a PATCH with `isOpen: false` and never a DELETE.
- The trash icon fires no DELETE until the `AlertDialog` is confirmed.
- At a 900 px window with three cards open, the two oldest render as chips.
- Send is `disabled` and its label names the reason.

**Not covered by tests, verify in a browser** (CLAUDE.md → Verification):
the card never sliding under the sidebar, the caret staying put through a save,
and both light and dark themes.

## Boundaries

**Always**
- Filter on `orgId` **and** `userId` in every query.
- Return 404 for someone else's draft.
- Flush the pending save before a card leaves the screen.
- Use design tokens. Check dark mode before calling a screen done.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before finishing.

**Ask first**
- Any new npm dependency.
- Any change to `schema.prisma` beyond the `EmailDraft` model above.
- Changing the 368 px dialer reserve, which couples this to the dialer spec.
- Raising `MAX_OPEN_DRAFTS` above 12.

**Never**
- Render a live-looking Send button that does nothing.
- Delete a draft on close.
- Reformat `bodyHtml` on the server.
- Import anything from `components/dialer/`. The two docks stay independent.
- Put a draft's body in a URL, a query string, or a log line.

## Success criteria

- [ ] All 12 acceptance criteria above hold in a browser, in both themes.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass.
- [ ] Open three cards, type in each, hard-refresh: all three come back with their text.
- [ ] Open a card, navigate `/home → /team → /home`: the card never unmounts.
- [ ] A second member of the same org cannot read, patch, or delete the first member's draft.
- [ ] The dock renders nothing at all when the rep has no drafts.

## Open questions

1. **Where does Compose live?** maincar had only the `c` hotkey plus per-record
   buttons. maincar-2's `Sidebar.tsx` has room for a primary **Compose** button.
   *(Recommendation: add it — a hotkey alone is undiscoverable.)*
2. **Mobile.** The dock is desktop-shaped. Below `lg`, hide it and open the
   composer full-screen, or hide Compose entirely? *(Recommendation: hide the
   dock below `lg` for now and say so, rather than ship a 384 px card on a 375 px
   phone.)*
