import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export type ReorderListEntriesInput =
  | {
      orgId: string
      listId: string
      entryIds: string[]
    }
  | {
      orgId: string
      listId: string
      entryId: string
      beforeEntryId?: string | null
      afterEntryId?: string | null
    }

/** Persists the membership order that People-list dialing consumes. */
export function useReorderListEntries() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ReorderListEntriesInput) => {
      const { orgId, listId } = input
      return jsonFetch<void>(`/api/orgs/${orgId}/lists/${listId}/entries/reorder`, {
        method: 'PATCH',
        body: JSON.stringify(
          'entryIds' in input
            ? { entryIds: input.entryIds }
            : {
                entryId: input.entryId,
                beforeEntryId: input.beforeEntryId ?? null,
                afterEntryId: input.afterEntryId ?? null,
              },
        ),
      })
    },
    onSuccess: (_response, { orgId, listId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.listEntries(orgId, listId) }),
  })
}
