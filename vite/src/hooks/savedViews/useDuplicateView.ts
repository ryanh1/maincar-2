import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { SavedViewResponse } from './types'

export type DuplicateViewVariables = { orgId: string; viewId: string }

/** Copies a visible view into the signed-in rep's Personal views. */
export function useDuplicateView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, viewId }: DuplicateViewVariables) =>
      jsonFetch<SavedViewResponse>(`/api/orgs/${orgId}/saved-views/${viewId}/duplicate`, { method: 'POST' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
