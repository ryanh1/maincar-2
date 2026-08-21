/**
 * The client's view of an email draft.
 *
 * These mirror `server/src/routes/email.ts` exactly — its `mapDraftToApi` is the
 * only shape that ever reaches the browser. `orgId` and `userId` are absent on
 * purpose: the caller is the author and names the org in the path, so the server
 * leaves both out rather than putting a tenant key in one more place that could
 * drift.
 *
 * They live in `lib/` rather than in `hooks/email/types.ts` because
 * `RecipientChip` is a UI shape the recipient fields need without touching a
 * hook (SPEC-composer-recipients.md → Project structure).
 */

/**
 * The typed CRM tables a draft's `recordId` can point to. `recordId` has no
 * database foreign key (server/prisma/schema.prisma → EmailDraft): a single
 * column cannot reference all three, so `recordObject` names which one and the
 * pair moves together — both null, or both set.
 */
export type RecordObject = 'person' | 'company' | 'deal'

/** One draft, as the API returns it. Timestamps are ISO strings, never `Date`. */
export interface EmailDraft {
  id: string
  /** The mailbox this will go out on. Null until composer-mailbox lands. */
  mailAccountId: string | null
  /** Which typed table `recordId` names. Null exactly when `recordId` is null. */
  recordObject: RecordObject | null
  /** The record the composer was opened from. Null until something sets it. */
  recordId: string | null
  toAddrs: string[]
  ccAddrs: string[]
  bccAddrs: string[]
  subject: string | null
  bodyHtml: string | null
  /**
   * Two flags, not one, because the X and the − are different acts. `isOpen`
   * false means the card left the dock but the draft was KEPT; `isMinimized`
   * means it is still in the dock, collapsed to a chip. Only a DELETE discards.
   */
  isOpen: boolean
  isMinimized: boolean
  createdAt: string
  updatedAt: string
}

/**
 * What a POST may set. Every field is optional because a card is created empty
 * the moment it opens, so every later save is a PATCH against an id that already
 * exists and no keystroke can race a create.
 */
export interface EmailDraftInput {
  mailAccountId?: string | null
  recordObject?: RecordObject | null
  recordId?: string | null
  toAddrs?: string[]
  ccAddrs?: string[]
  bccAddrs?: string[]
  subject?: string | null
  bodyHtml?: string | null
}

/**
 * What a PATCH may set: everything POST accepts, plus the two dock-state flags.
 *
 * Send only the keys that changed. The route writes exactly the keys the body
 * carries, so `{ isMinimized: true }` leaves a half-written `bodyHtml` alone.
 */
export interface EmailDraftPatch extends EmailDraftInput {
  isOpen?: boolean
  isMinimized?: boolean
}

/** The drafts list. Oldest first, because the dock lays cards out left to right. */
export interface GetEmailDraftsResponse {
  drafts: EmailDraft[]
  total: number
}

/** What POST and PATCH return: the stored row, wrapped. */
export interface EmailDraftResponse {
  draft: EmailDraft
}

/**
 * What DELETE returns. The id comes back so the client can drop exactly that
 * card without having to trust the request it just sent.
 */
export interface DeleteEmailDraftResponse {
  draft: { id: string }
}

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

/**
 * The client's view of an email template.
 *
 * Mirrors `mapTemplateToApi` in `server/src/routes/email.ts` exactly. `orgId` is
 * absent for the same reason it is absent from a draft — the caller named the
 * org in the path.
 *
 * A template is ORG-SHARED, not private to whoever wrote it, which is why there
 * is no `userId` here and no way to ask for "my" templates. Any member may read,
 * edit, or delete any of them (SPEC-composer-templates.md § 2).
 */
export interface EmailTemplate {
  id: string
  /** What the dropdown shows. Never blank — the route refuses an empty name. */
  name: string
  /**
   * Never null, unlike a draft's. The columns are not nullable: a template saved
   * without a subject or a body stores the empty string.
   */
  subject: string
  bodyHtml: string
  /**
   * Attribution only, never a filter. **Null is not an error** — it means the
   * rep who wrote this template has left the org, and the template outlived
   * them, which is the point of an org-shared template.
   */
  createdById: string | null
  /**
   * The distinct merge-field ids this template uses, derived SERVER-SIDE from
   * the subject and body on every write. Null on every template today: the
   * column stays empty until merge fields land with the CRM port
   * (SPEC-composer-body.md § Deferred). Read it, never send it — the server
   * strips a client-supplied value, because the text wins.
   */
  fieldsJson: string[] | null
  createdAt: string
  updatedAt: string
}

/**
 * What POST accepts. `name` is the one field a template cannot do without: it is
 * what the dropdown shows, and an unnamed template is unpickable. Subject and
 * body may be omitted — a rep saving a shell to fill in later is not an error.
 *
 * `fieldsJson` is absent on purpose. It is derived, and the server ignores it.
 */
export interface EmailTemplateInput {
  name: string
  subject?: string
  bodyHtml?: string
}

/**
 * What PATCH accepts: the same fields, all optional, but a patch with no keys at
 * all is a 400. The route writes exactly the keys the body carries, so
 * `{ name }` alone leaves the body untouched.
 */
export interface EmailTemplatePatch {
  name?: string
  subject?: string
  bodyHtml?: string
}

/** The templates list. Alphabetical, because that is what the settings screen shows. */
export interface GetEmailTemplatesResponse {
  templates: EmailTemplate[]
  total: number
}

/** What POST and PATCH return: the stored row, wrapped. */
export interface EmailTemplateResponse {
  template: EmailTemplate
}

/** What DELETE returns — the id, so the client can drop exactly that row. */
export interface DeleteEmailTemplateResponse {
  template: { id: string }
}
