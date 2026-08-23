import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export type ReorderViewsVariables = {
  orgId: string
  objectId: string
  viewIds: string[]
}

/** Persists the complete visible-view order atomically for one CRM object. */
export function useReorderViews() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, objectId, viewIds }: ReorderViewsVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/saved-views/reorder`, {
        method: 'POST',
        body: JSON.stringify({ objectId, viewIds }),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
