import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { ViewConfig } from '@/components/crm/viewConfig'
import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { SavedViewResponse } from './types'

export type SaveViewVariables = {
  orgId: string
  objectId: string
  name: string
  config: ViewConfig
  layout?: 'list' | 'grid' | 'kanban'
  makeDefault?: boolean
}

/** Creates the first persistent view when the object only has its in-code default. */
export function useSaveView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orgId, objectId, name, config, layout = 'grid', makeDefault = true }: SaveViewVariables) => {
      const saved = await jsonFetch<SavedViewResponse>(`/api/orgs/${orgId}/saved-views`, {
        method: 'POST',
        body: JSON.stringify({ objectId, name, layout, config }),
      })
      if (makeDefault) {
        await jsonFetch<void>(`/api/orgs/${orgId}/saved-views/${saved.view.id}/default`, { method: 'POST' })
      }
      return saved
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all(variables.orgId) }),
  })
}
