import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
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
 * Invalidates on ERROR ONLY, and the asymmetry is deliberate:
 *
 *  - On success there is nothing to learn. The response echoes the id back, so
 *    the dock drops exactly that card without having to trust the request it
 *    just sent, and a refetch would only re-read rows the dock already holds —
 *    while handing the provider stale server copies of the cards still being
 *    typed in.
 *  - On error the dock and the server now disagree, and only the server knows
 *    which way. The draft may be gone already (a 404 from a double click) or
 *    still there (a 500). Refetching the list is how the corner resyncs instead
 *    of stranding a card that no longer exists, or losing one that does.
 *
 * The rejection carries the server's own message through `ApiError`, so the
 * dialog can say "Draft not found" rather than a guess.
 */
export function useDeleteEmailDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, draftId }: DeleteEmailDraftVariables) =>
      jsonFetch<DeleteEmailDraftResponse>(`/api/email/orgs/${orgId}/drafts/${draftId}`, {
        method: 'DELETE',
      }),
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.drafts(variables.orgId) })
    },
  })
}
