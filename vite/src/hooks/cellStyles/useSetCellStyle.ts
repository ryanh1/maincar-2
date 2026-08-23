import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { CellStyleResponse } from './types'

export type SetCellStyleVariables = {
  orgId: string
  viewId: string
  recordId: string
  fieldId: string
  backgroundToken: string | null
  textToken: string | null
}

/** Paints (or repaints) one stored scalar cell in one view. */
export function useSetCellStyle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, ...body }: SetCellStyleVariables) =>
      jsonFetch<CellStyleResponse>(`/api/orgs/${orgId}/cell-styles`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.cellStyles.all(variables.orgId) }),
  })
}
