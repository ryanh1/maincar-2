# Spec: `composer-body`

> Module `composer-body` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
> Depends on: `composer-dock`. Phase 2.
>
> **Decisions (2026-08-20): TipTap is approved.** Merge fields and preview **wait
> for the contacts database** — they are specified in full under
> [§ Deferred](#deferred--blocked-on-the-crm-schema) and are not built now.

## Objective

The subject line and the message body of a composer card: a real rich-text
editor, built as a **shared, generic** component that knows nothing about email,
so notes and signatures can use the same one later.

**Success looks like:** a rep writes a properly formatted email — bold, a bulleted
list, a link — and the caret never jumps while autosave runs.

### Acceptance criteria — build now

1. The subject is a plain single-line input on a `Re` row, `text-sm`, with no
   border of its own — the row's bottom border is the only edge.
2. The body is a TipTap editor with a **compact** toolbar: bold, italic, bullet
   list, numbered list, link. Nothing else.
3. The link button opens a small dialog for the URL. A link with no scheme gets
   `https://`. `javascript:` URLs are rejected.
4. A placeholder reads "Write a message" and disappears on the first keystroke.
5. The editor fills the card's remaining height and scrolls inside it. The card
   never grows past `h-[26rem]`.
6. Pasting from Word, Google Docs, or a web page produces clean HTML — the
   allowed marks only, no inline styles, no `<font>`, no classes.
7. Stored HTML is sanitised before it is saved **and** again before it is
   rendered anywhere. Client-side sanitising is never trusted on its own.
8. `Cmd/Ctrl+B`, `+I`, and `+K` work.
9. **The caret never moves because a save came back.** The editor is created
   once; nothing re-renders it from a response.
10. The toolbar is keyboard-reachable, and every button has an `aria-label` and
    an `aria-pressed` state.

## Tech stack

React 19, plus **TipTap** — `@tiptap/core`, `@tiptap/react`,
`@tiptap/starter-kit`, `@tiptap/extension-link`,
`@tiptap/extension-placeholder`. Sanitising: `dompurify` on the client,
`sanitize-html` on the server.

`@tiptap/suggestion` is a **deferred** dependency — it is only needed for the
`{{` menu. Do not add it now.

## Commands

Same as [`composer-dock`](SPEC-composer-dock.md#commands), plus:

```bash
npm --workspace vite install @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder dompurify
```

```bash
npm --workspace server install sanitize-html
```

## Project structure

```
vite/src/components/editor/
  RichTextEditor.tsx          → NEW. Shared and generic. Knows nothing about email.
  RichTextEditor_Toolbar.tsx  → NEW
  RichTextEditor_UrlDialog.tsx→ NEW
  editorExtensions.ts         → NEW. The extension list, in one place
  SanitizedHtml.tsx           → NEW. The only way stored HTML is ever rendered
  richTextEditor.css          → NEW
  RichTextEditor.test.tsx     → NEW
vite/src/components/composer/ComposerCard.tsx → the Re row + the editor
server/src/lib/sanitizeHtml.ts → NEW. The allow-list, shared by every write path
server/src/lib/__tests__/sanitizeHtml.test.ts → NEW
```

`RichTextEditor` is shared and generic. Nothing about email, records, or merge
fields belongs inside it. Keeping that line clean now is what makes the deferred
work below a wrapper rather than a rewrite.

## Code style

```tsx
// The editor is created ONCE. Anything it must see live — the sanitiser, the
// callbacks — is read through a ref, not through the extensions array: changing
// that array tears the editor down and loses the rep's cursor.
const live = useRef({ onChange })
live.current = { onChange }
```

```ts
// The allow-list is a list of what is PERMITTED, never a list of what is blocked.
// A blocklist is wrong the day a new tag ships.
export const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li']
export const ALLOWED_ATTR: Record<string, string[]> = { a: ['href', 'target', 'rel'] }
```

## Testing strategy

- Bold, italic, and both list types round-trip through save and reload unchanged.
- A pasted `<script>` is stripped. A pasted `<p style="...">` keeps the `<p>` and
  loses the style.
- `javascript:alert(1)` as a link URL is rejected.
- A link with no scheme is stored with `https://`.
- Typing does not fire a save on every keystroke — one save after the debounce.
- The toolbar reflects the state at the caret (`aria-pressed`).

**Verify in a browser** (CLAUDE.md → Verification): paste a formatted paragraph
out of Google Docs, watch the caret sit still through an autosave, and check the
toolbar in both themes.

## Boundaries

**Always** — sanitise on the server as well as the client; use an allow-list;
keep `RichTextEditor` free of email concepts.
**Ask first** — any toolbar button beyond the five listed; images or attachments
in the body; adding `@tiptap/suggestion` before the CRM lands.
**Never** — render stored HTML with `dangerouslySetInnerHTML` outside
`SanitizedHtml`; re-render the editor from a save response; trust the client's
sanitising alone.

## Success criteria

- [ ] All 10 acceptance criteria hold in a browser, both themes.
- [ ] `npm run typecheck && npm run lint && npm test` pass.
- [ ] A paste from Google Docs produces only allowed tags.
- [ ] Type continuously for 30 seconds: the caret never moves on its own.

---

## Deferred — blocked on the CRM schema

**Waits on:** [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md) — `Person`, `Company`, `ContactEmail`, and the
`AttributeDef` custom fields, which is where the Custom merge-field category comes
from.

Merge fields are the `{{first_name}}` placeholders that make one written email
land as fifty personal ones, plus the preview that shows a rep what a real
recipient will see. Every one of them reads CRM data, so none of it is built now.

Adds `@tiptap/suggestion` when it lands.

### Acceptance criteria

1. Typing `{{` in the body opens the merge-field menu inline. An **Insert field**
   toolbar button opens the same menu.
2. A merge field renders as an **atomic chip**. One Backspace removes the whole
   chip. It is impossible to delete half of one. *(This is the reason TipTap was
   chosen over a textarea: a half-deleted `{{first_nam}}` ships a broken email to
   a customer.)*
3. A chip shows the field's label, not its id — "First name", not `first_name`.
4. Chip states: neutral with no recipient chosen, normal when the field has a
   value for the chosen recipient, amber when it does not.
5. Clicking a chip opens a dialog to set a fallback — `{{first_name | there}}`.
6. What is **stored** is the brace form, in both subject and body. The chip is a
   rendering, never the storage.
7. The eye icon previews the email resolved against the first known person in To,
   and lists which fields are missing and which fell back.
8. Missing means **no value and no fallback**. A field that fell back resolved —
   that is the point of writing a fallback.
9. Merge values are escaped for HTML in the body and not in the subject.

### Storage format

```
stored:   <p>Hi {{first_name | there}}, about {{company}}…</p>
rendered: <p>Hi [First name] , about [Company]…</p>   ← chips
resolved: <p>Hi Ann, about Acme…</p>
```

One representation: readable in the database, safe to hand to a plain-text mail
part later, and identical for preview and for send.

### Files it will add

```
server/src/lib/mail/mergeGrammar.ts   → parse {{field}} and {{field | fallback}}. Pure.
server/src/lib/mail/mergeFields.ts    → the EMAIL renderer: escape, resolve, report missing
server/src/lib/mail/mergeCatalogue.ts → which fields exist, their labels and examples
server/src/routes/email.ts            → GET .../merge-fields, GET .../merge-values, POST .../preview
vite/src/components/editor/MergeFieldNode.ts | MergeFieldSuggestion.ts
vite/src/components/composer/MergeFieldEditor.tsx | MergeFieldMenu.tsx | MergeFieldFallbackDialog.tsx | ComposerCard_Preview.tsx
vite/src/lib/mergeFieldToken.ts       → storageToEditorHtml / editorHtmlToStorage
```

### Two rules to carry forward

```ts
/**
 * Escape the substituted value for HTML. TRUE for a body, FALSE for a subject.
 *
 * This is not optional politeness: a person whose company is literally
 * `<script>` would otherwise inject markup into every email that merges it.
 */
export interface ResolveOptions { escapeHtml: boolean }
```

The resolver is **pure** — no Prisma, no requests, no editor. One copy, shared by
preview and by send. Two copies drift, and they drift in the worst possible way:
a preview that looks right and an email that goes out saying `{{first_name}}`.

Nothing here may invent a value that is not in the data (CLAUDE.md → AI drafting).
