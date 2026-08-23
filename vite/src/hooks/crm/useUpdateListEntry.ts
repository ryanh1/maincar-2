import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CrmListEntry } from '@/lib/crmTypes'

export interface UpdateListEntryInput {
  orgId: string
  listId: string
  entryId: string
  valuesJson: Record<string, unknown>
}

/** Saves values on ListEntry.valuesJson, never through an object-record route. */
export function useUpdateListEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, listId, entryId, valuesJson }: UpdateListEntryInput) =>
      jsonFetch<{ entry: CrmListEntry }>(`/api/orgs/${orgId}/lists/${listId}/entries/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ valuesJson }),
      }),
    onSuccess: (_response, { orgId, listId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.listEntries(orgId, listId) }),
  })
}
