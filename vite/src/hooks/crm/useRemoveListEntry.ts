import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface RemoveListEntryInput {
  orgId: string
  listId: string
  entryId: string
}

/** Removes a membership only; the target record remains intact. */
export function useRemoveListEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, listId, entryId }: RemoveListEntryInput) =>
      jsonFetch(`/api/orgs/${orgId}/lists/${listId}/entries/${entryId}`, { method: 'DELETE' }),
    onSuccess: (_response, { orgId, listId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.listEntries(orgId, listId) }),
  })
}
