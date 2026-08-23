import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export type SetDefaultViewVariables = { orgId: string; viewId: string }

/** Replaces the relevant Personal or Shared default view. */
export function useSetDefaultView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, viewId }: SetDefaultViewVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/saved-views/${viewId}/default`, { method: 'POST' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
