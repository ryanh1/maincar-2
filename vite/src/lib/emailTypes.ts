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

/** One draft, as the API returns it. Timestamps are ISO strings, never `Date`. */
export interface EmailDraft {
  id: string
  /** The mailbox this will go out on. Null until composer-mailbox lands. */
  mailAccountId: string | null
  /** The record the composer was opened from. Null until the CRM port lands. */
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
