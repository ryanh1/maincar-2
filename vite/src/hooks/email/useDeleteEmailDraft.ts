import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { DeleteEmailDraftResponse } from '@/lib/emailTypes'

/** Which draft to throw away, in which org. */
export interface DeleteEmailDraftVariables {
  orgId: string
  draftId: string
}

/**
 * Discard a draft. The only call in the composer that destroys one — closing a
 * card is a save with `isOpen: false`, and this is the trash can, behind an
 * `AlertDialog` (SPEC-composer-dock.md → API).
 *
 * **A 404 is a success, not an error.** The rep asked for the row to be gone and
 * it is gone, so there is nothing to tell them and nothing to resync; saying
 * "Draft not found" over a card they just discarded describes the app's problem,
 * not theirs (MAI-88). The one caller that could send a duplicate DELETE is
 * guarded in `ComposerProvider.discardDraft`; this is the second line, and it
 * also covers the rep who discarded the same draft from another tab.
 *
 * Every other failure invalidates, and the asymmetry with success is deliberate:
 *
 *  - On success there is nothing to learn. The response echoes the id back, so
 *    the dock drops exactly that card without having to trust the request it
 *    just sent, and a refetch would only re-read rows the dock already holds —
 *    while handing the provider stale server copies of the cards still being
 *    typed in.
 *  - On a real error (a 500) the dock and the server now disagree, and only the
 *    server knows which way. Refetching the list is how the corner resyncs
 *    instead of losing a card that still exists.
 *
 * The rejection carries the server's own message through `ApiError`, so the
 * toast says what the server said rather than a guess.
 */
export function useDeleteEmailDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, draftId }: DeleteEmailDraftVariables) => {
      try {
        return await jsonFetch<DeleteEmailDraftResponse>(
          `/api/email/orgs/${orgId}/drafts/${draftId}`,
          { method: 'DELETE' },
        )
      } catch (err) {
        // Already gone is the outcome that was asked for. Echo the id back the
        // way the 200 does, so the dock drops the card either way.
        if (err instanceof ApiError && err.status === 404) return { draft: { id: draftId } }
        throw err
      }
    },
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.drafts(variables.orgId) })
    },
  })
}
