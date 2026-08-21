import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { DeleteEmailTemplateResponse } from '@/lib/emailTypes'

/** Which template to remove, in which org. */
export interface DeleteEmailTemplateVariables {
  orgId: string
  templateId: string
}

/**
 * Delete a template, from behind the settings screen's `AlertDialog`
 * (SPEC-composer-templates.md § 9). Drafts written from it are untouched: the
 * body was copied into the card at pick time and there is no link back.
 *
 * **A 404 is a success, not an error**, exactly as in `useDeleteEmailDraft` — and
 * the case is more common here, not less. A draft has one author, so a duplicate
 * DELETE needs the same rep in two tabs. A template is org-shared, so two reps
 * really can open Settings, see the same stale row, and both confirm the dialog.
 * The second one gets a 404 for a row that is gone, which is precisely what they
 * asked for; a "Template not found" toast would describe the app's race, not
 * their problem.
 *
 * **Unlike the draft hook, this one invalidates on success as well as on
 * failure.** The draft version skips the success invalidation because refetching
 * would hand the composer provider server copies of cards still being typed in.
 * There is no such cost here, and there IS a reason to refetch either way:
 *
 *  - After a delete that worked, the org-shared list this client is holding may
 *    also be missing a template a teammate added, or showing one they renamed.
 *  - After a 404, the list is definitely stale — it still shows a row the server
 *    does not have.
 *  - After a real failure the client and the server disagree and only the server
 *    knows which way, so a refetch is how the screen resyncs instead of dropping
 *    a template that still exists.
 *
 * The rejection carries the server's own message through `ApiError`, so the
 * toast says what the server said rather than a guess.
 */
export function useDeleteEmailTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, templateId }: DeleteEmailTemplateVariables) => {
      try {
        return await jsonFetch<DeleteEmailTemplateResponse>(
          `/api/email/orgs/${orgId}/templates/${templateId}`,
          { method: 'DELETE' },
        )
      } catch (err) {
        // Already gone is the outcome that was asked for. Echo the id back the
        // way the 200 does, so the caller drops exactly that row either way.
        if (err instanceof ApiError && err.status === 404) return { template: { id: templateId } }
        throw err
      }
    },
    // onSettled, not onSuccess: the list wants rereading whichever way this went.
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.templates(variables.orgId) })
    },
  })
}
