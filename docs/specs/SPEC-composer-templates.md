# Spec: `composer-templates`

> Module `composer-templates` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
> Depends on: `composer-body`. Phase 3.
>
> **Decision (2026-08-20):** templates ship with the plain rich-text editor.
> Merge fields inside a template wait for the contacts database, with the rest of
> the merge-field work ([SPEC-composer-body.md](SPEC-composer-body.md) § Deferred,
> which waits on [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md)).

## Objective

A rep sends the same five emails over and over. This module lets them save one
once, with merge fields in it, and drop it into any composer card.

**Success looks like:** a rep addresses a customer, picks "Follow-up after call",
and has a personalised email ready to review in two clicks.

### Acceptance criteria

1. Settings → Email templates lists this org's templates alphabetically.
2. Any member can create, edit, and delete a template. Templates are org-wide,
   not private to their author.
3. A template has a name, a subject, and a body, and the body uses the **same**
   editor the composer card uses — one editor, not two. It is `RichTextEditor`
   now and `MergeFieldEditor` once merge fields land.
4. *(Deferred with merge fields.)* The template list shows how many merge fields
   each template uses.
5. The composer card's file icon opens a dropdown of templates.
6. Picking a template replaces the subject and the body and **keeps the
   recipients** — a rep picks a template after choosing who it is going to.
7. Picking a template into a card with text already in it asks first.
8. With no templates yet, the dropdown says so and points at Settings, rather
   than showing an empty menu.
9. Deleting a template asks for confirmation and never touches drafts that were
   created from it.

## Tech stack

No new dependencies. Reuses `RichTextEditor` from `composer-body` and the
existing `DropdownMenu`, `Dialog`, and `AlertDialog` primitives.

## Commands

Same as [`composer-dock`](SPEC-composer-dock.md#commands).

## Project structure

```
server/prisma/schema.prisma       → add EmailTemplate
server/src/routes/email.ts        → add GET/POST/PATCH/DELETE .../templates
server/src/routes/__tests__/email-templates.test.ts → NEW
vite/src/pages/settings/EmailTemplates.tsx          → NEW
vite/src/components/composer/ComposerCard.tsx       → the template dropdown
vite/src/hooks/email/useGetEmailTemplates.ts | useSaveEmailTemplate.ts | useDeleteEmailTemplate.ts
```

## Data model

```prisma
model EmailTemplate {
  id          String   @id @default(cuid())
  org         Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId       String
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdById String
  name        String
  subject     String
  bodyHtml    String
  // The distinct merge-field ids this template uses, derived from the text on
  // every write by fieldsUsed(). Stored so the list can say "uses 3 fields"
  // without re-parsing every body. DERIVED data, never authoritative: the text
  // wins. Stays null until merge fields land with the CRM port.
  fieldsJson  Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([orgId, name])
}
```

## Code style

```tsx
onSelect={() => {
  // Replaces the subject and body, KEEPS the recipients — a rep picks a template
  // after choosing who it is going to.
  setSubject(template.subject)
  setBody(template.bodyHtml)
}}
```

`fieldsJson` is recomputed on **every** write, server-side, from the stored text.
It is never sent by the client and never trusted from the client.

## Testing strategy

**Server**
- Creating a template derives its field list from subject and body together.
- Editing the body recomputes the field list.
- A client-supplied `fieldsJson` is ignored.
- A template from another org is a 404.
- Name is required and capped; subject and body are capped.

**Client**
- The dropdown lists templates alphabetically.
- Picking one replaces subject and body and leaves the To chips alone.
- Picking one into a card with text asks first.
- No templates → the menu shows the pointer to Settings, disabled.

**Verify in a browser:** a template with merge fields, inserted into a card that
already has a recipient, previews correctly filled in.

## Boundaries

**Always** — derive the field list on the server; scope every query to the org;
reuse the shared editor rather than building a second one.
**Ask first** — per-user private templates; template folders or categories;
attaching a template to a campaign or sequence.
**Never** — mutate an existing draft when a template is edited; render a template
picker that inserts nothing; store a second copy of the merge-field grammar.

## Success criteria

- [ ] All 9 acceptance criteria hold in a browser, both themes.
- [ ] `npm run typecheck && npm run lint && npm test` pass.
- [ ] Save a template, insert it into a card that already has recipients, and
      confirm the recipients are untouched.

## Open questions

1. Org-wide or private-to-author? *(Recommendation: org-wide. A template a
   teammate cannot use is a note to self.)*
2. Should the composer offer "Save this as a template" from inside a card?
   *(Recommendation: yes, but as a follow-up — it is one button and it is the
   thing that actually gets templates written.)*
