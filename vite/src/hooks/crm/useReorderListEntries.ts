import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface ReorderListEntriesInput {
  orgId: string
  listId: string
  entryIds: string[]
}

/** Persists the complete membership order that People-list dialing consumes. */
export function useReorderListEntries() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, listId, entryIds }: ReorderListEntriesInput) =>
      jsonFetch<void>(`/api/orgs/${orgId}/lists/${listId}/entries/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ entryIds }),
      }),
    onSuccess: (_response, { orgId, listId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.listEntries(orgId, listId) }),
  })
}
