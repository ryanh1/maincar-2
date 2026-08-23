import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export type DeleteViewVariables = { orgId: string; viewId: string }

/** Soft-deletes a non-default view without touching its records. */
export function useDeleteView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, viewId }: DeleteViewVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/saved-views/${viewId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
