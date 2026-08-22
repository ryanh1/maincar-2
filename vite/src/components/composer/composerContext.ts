import { createContext, useContext } from 'react'

import type { EmailDraft, EmailDraftInput, EmailDraftPatch } from '@/lib/emailTypes'

/**
 * Kept apart from `ComposerProvider.tsx` for the same reason `useAuth.ts` is kept
 * apart from `AuthProvider.tsx`: a module that exports both a component and a
 * non-component breaks fast refresh and trips `eslint-plugin-react-refresh`.
 *
 * `ComposerProvider` owns the state. This file is the read side — the context
 * object and the two hooks every card, chip, and Compose button reads it through.
 */
export interface ComposerContextValue {
  /** Every draft this rep has here, open and closed, oldest first. */
  drafts: EmailDraft[]
  /** The cards in the dock right now, expanded or minimized. */
  openDrafts: EmailDraft[]
  /**
   * Closed but KEPT. These are what the dock's "3 drafts" button counts, and the
   * last one is the most recently closed, so that button knows which to reopen.
   */
  keptDrafts: EmailDraft[]
  /**
   * Open a card. Creates the row on the server first — empty unless a composer
   * opened from a record seeds a recipient — and resolves with the stored draft,
   * or null when the create failed or there is no org yet.
   */
  openComposer: (seed?: EmailDraftInput) => Promise<EmailDraft | null>
  /**
   * One save. Send ONLY the keys that changed: the route writes exactly the keys
   * the body carries, so a state change leaves a half-written body alone.
   */
  saveDraft: (draftId: string, patch: EmailDraftPatch) => Promise<void>
  /** Take the card out of the dock and KEEP the draft. A save, never a delete. */
  closeCard: (draftId: string) => Promise<void>
  /** Put a saved draft back in the dock. */
  reopenCard: (draftId: string) => Promise<void>
  /** Throw the draft away. The only call here that destroys one. */
  discardDraft: (draftId: string) => Promise<void>
}

export const ComposerContext = createContext<ComposerContextValue | null>(null)

/**
 * The composer state, or null outside the provider.
 *
 * For components that render both inside the dock and on their own in a test —
 * a Compose button, a per-record mail icon — where a throw would fail the test
 * for a reason that has nothing to do with what it is checking.
 */
export function useComposerOptional(): ComposerContextValue | null {
  return useContext(ComposerContext)
}

/**
 * The composer state. Throws outside the provider, because a card that silently
 * did nothing would look like a broken button rather than a missing provider.
 */
export function useComposer(): ComposerContextValue {
  const value = useContext(ComposerContext)
  if (!value) {
    throw new Error('useComposer must be used inside <ComposerProvider>.')
  }
  return value
}
