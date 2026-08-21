import { useMutation } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { EmailDraftPatch, EmailDraftResponse } from '@/lib/emailTypes'

/**
 * One autosave. Send ONLY the keys that changed — the route writes exactly the
 * keys the body carries, so `{ isMinimized: true }` leaves a half-written
 * `bodyHtml` alone, and a patch with no keys at all is a 400.
 */
export interface UpdateEmailDraftVariables extends EmailDraftPatch {
  orgId: string
  draftId: string
}

/**
 * Save a draft: autosave 1200 ms after the last keystroke, and every dock-state
 * change (minimize, restore, close).
 *
 * **This hook must never call `invalidateQueries`, and that is the rule most
 * likely to be broken by accident** (tasks/plan-email-composer.md → decision 3).
 *
 * The card owns its own text while it is open. It reports upward on a debounce
 * and never re-reads its own saved value. An invalidation here would refetch the
 * drafts list in the middle of a sentence and push the server's copy of the body
 * back at an editor the rep is still typing in — which resets the caret to the
 * end, and silently loses whatever was typed during the round trip. The failure
 * looks like a flicker, so it survives review.
 *
 * That is also why the response is not written into the drafts cache by hand:
 * seeding the cache is the same push by another route. The dock's own state is
 * the source of truth for an open card; the list query only hydrates it once, on
 * first load.
 *
 * Closing a card is one of these saves — `{ isOpen: false }` — not a delete. The
 * draft is kept, and only `useDeleteEmailDraft` throws one away.
 *
 * A failed save rejects with an `ApiError` carrying the server's own message
 * (404 "Draft not found" when the draft is gone or belongs to someone else).
 */
export function useUpdateEmailDraft() {
  return useMutation({
    mutationFn: ({ orgId, draftId, ...body }: UpdateEmailDraftVariables) =>
      jsonFetch<EmailDraftResponse>(`/api/email/orgs/${orgId}/drafts/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  })
}
