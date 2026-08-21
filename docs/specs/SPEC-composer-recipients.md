# Spec: `composer-recipients`

> Module `composer-recipients` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
> Depends on: `composer-dock`. Phase 2.
>
> **Decision (2026-08-20): autocomplete waits for the contacts database.** This
> module builds the chip fields and typed addresses only. The suggestion dropdown
> is specified in full under [§ Deferred](#deferred--blocked-on-the-crm-schema)
> and is not built now.

## Objective

The To, Cc, and Bcc fields of a composer card. The point of this module is that
**a recipient is a chip, not text** — one Backspace removes a whole person, and a
rep can see at a glance who the email is addressed to.

**Success looks like:** a rep addresses five people and removes one without
touching the mouse.

### Acceptance criteria — build now

1. **To** is visible always. **Cc** and **Bcc** are hidden behind a `Cc/Bcc`
   link, and are shown from the start when the draft already has either.
2. `Enter`, `,`, and `Tab` turn what was typed into a chip.
3. **Backspace in an empty box deletes the whole last chip**, never one character
   of it.
4. Blur commits what was typed rather than throwing it away.
5. An empty box plus `Enter` does nothing — no empty chip.
6. The same address twice adds one chip, matched case-insensitively.
7. Every chip has its own `✕`, labelled `Remove {address}` for screen readers.
8. A chip renders neutral: `border-border bg-muted text-foreground`. The tinted
   "we know this person" state is defined below and unused until the CRM lands.
9. Chips wrap onto a second line inside the field rather than scrolling sideways.
10. The field is keyboard-reachable and the chips are in the tab order.

**Deliverability is not checked here.** A rep types a recipient over several
keystrokes and autosave fires in the middle. Addresses are validated for shape
only — `z.string().trim().min(1).max(320)`, capped at 100 per field. The one real
check happens at send, in `composer-send`.

## Tech stack

React 19, Tailwind 4, `lucide-react`. **No new dependencies** and, for now, **no
new API route** — this module is client-only on top of `composer-dock`'s draft
storage.

## Commands

Same as [`composer-dock`](SPEC-composer-dock.md#commands).

## Project structure

```
vite/src/components/composer/
  ComposerCard_Recipients.tsx      → NEW. RecipientField + Chip
  ComposerCard_Recipients.test.tsx → NEW
vite/src/lib/emailTypes.ts         → RecipientChip
```

```ts
/**
 * One entry in a To/Cc/Bcc field.
 *
 * `recordId` is null for every chip today, because there is no CRM to match an
 * address against. The field exists from day one anyway: it is what will make a
 * chip a link to a person, and adding it later would change every call site.
 */
export interface RecipientChip {
  address: string
  displayName: string | null
  recordId: string | null
}
```

## Code style

```tsx
function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  // Backspace on an empty box deletes the WHOLE last chip, not one character of it.
  if (event.key === 'Backspace' && query === '' && chips.length > 0) {
    event.preventDefault()
    onChange(chips.slice(0, -1))
    return
  }
  if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
    if (query.trim() === '') return
    event.preventDefault()
    addTyped()
  }
}
```

Chip styling: `inline-flex h-6 max-w-full items-center gap-1 rounded-full border
px-2 text-xs`, icons at 14 px inside a chip. Field row: `flex items-start gap-2
border-b border-border px-3 py-1`, label `w-8 text-xs font-medium
text-muted-foreground`. Every colour is a token — see
[design-system.md](../../.claude/rules/design-system.md).

## Testing strategy

- Type + `Enter` → the text becomes a chip and the box empties.
- Comma and Tab both commit.
- Backspace on an empty box removes the last chip; with text in the box it edits
  the text instead.
- Blur with text pending commits it as a chip.
- The same address twice, in different case, adds one chip.
- `Enter` on an empty box adds nothing.
- The `✕` on a chip removes only that chip.
- `Cc/Bcc` reveals both fields; a draft that already has a Cc shows them on open.

**Verify in a browser:** eight chips wrapping to a second line without the card
growing past `h-[26rem]`, and both themes.

## Boundaries

**Always** — treat a recipient as a chip; commit on blur; keep `recordId` on the
type even while it is always null.
**Ask first** — adding a combobox dependency; adding any server route to this
module before the CRM lands.
**Never** — validate deliverability here; render an "Add to CRM" control (there
is no CRM — leave it out entirely rather than disabled); join a person's
addresses into one string.

## Success criteria

- [ ] All 10 acceptance criteria hold in a browser, both themes.
- [ ] `npm run typecheck && npm run lint && npm test` pass.
- [ ] Five recipients addressed and one removed with the keyboard alone.
- [ ] Recipients survive a hard refresh, via `composer-dock`'s autosave.

---

## Deferred — blocked on the CRM schema

Not built now. Specified so it lands as wiring, not a redesign.

**Waits on:** [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md) — specifically `Person`, `ContactEmail`
(`address`, `isPrimary`, `status`), and `Company`. Note that `ContactEmail.status`
carries `dead | bounced | unsubscribed`; a suggestion in one of those states must
be visibly marked, and an unsubscribed address must not be offered at all.

### Acceptance criteria

1. Typing filters a suggestion dropdown, grouped by tier with a heading per tier.
2. `Enter` takes the first suggestion when one is showing; otherwise the raw text.
3. A person with three `ContactEmail` rows is **three** choices, never one joined
   string. Their `isPrimary` one sorts first.
4. The dropdown always offers `Use "{what they typed}"` as its last row.
5. A chip that came from the CRM is tinted `border-primary/40 bg-primary/10
   text-primary` and links to that person. A typed chip stays neutral.
6. The dropdown names the tiers it cannot fill yet, honestly, in one muted line.
7. `Escape` closes the dropdown and leaves the text.

### API

`GET /api/email/orgs/:orgId/recipients?q=&recordId=&limit=`

```ts
type RecipientTier = 'same-company' | 'crm-person'

interface RecipientSuggestion {
  recordId: string
  displayName: string
  address: string
  context: string | null   // the line under the name: their title
  tier: RecipientTier
}

interface RecipientsResponse {
  recipients: RecipientSuggestion[]
  total: number
  /** Tiers with no data source yet, and what each waits on. */
  tiersNotAvailable: { tier: string; waitingOn: string }[]
}
```

Ranking, in order. maincar's route documents five tiers:

| Tier | Source | Available when? |
|---|---|---|
| 1. People on this thread | Email threads | After `composer-send` |
| 2. Others at the same company | `Person.companyId` → `Company` | With the CRM schema |
| 3. Recent correspondents | Mail sync | After mail sync |
| 4. Any CRM person | `Person` → `ContactEmail` | With the CRM schema |
| 5. The raw typed address | The rep | **Now** — the client adds this, not the server |

Return the tiers you can fill and **label every result with its tier**, so the
client groups them honestly and the missing tiers slot in without changing the
response shape. An empty tier that reads as "nobody matched" is worse than
saying so.

### One implementation note worth keeping

```tsx
// mousedown, not click: the input's blur would close the dropdown first and the
// click would land on nothing.
onMouseDown={(event) => { event.preventDefault(); add(item) }}
```
