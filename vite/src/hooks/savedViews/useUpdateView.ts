import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { ViewConfig } from '@/components/crm/viewConfig'
import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { SavedViewResponse } from './types'

export type UpdateViewVariables = {
  orgId: string
  viewId: string
  config: ViewConfig
}

/** Persists configuration edits to an existing view. */
export function useUpdateView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, viewId, config }: UpdateViewVariables) =>
      jsonFetch<SavedViewResponse>(`/api/orgs/${orgId}/saved-views/${viewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ config }),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
