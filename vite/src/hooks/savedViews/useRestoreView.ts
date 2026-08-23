import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export type RestoreViewVariables = { orgId: string; viewId: string }

/** Restores a view removed by the delete undo toast. */
export function useRestoreView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, viewId }: RestoreViewVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/saved-views/${viewId}/restore`, { method: 'POST' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
