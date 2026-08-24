import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { PatchAttributeResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface ReorderAttributesInput {
  orgId: string
  objectId: string
  attributeIds: string[]
}

/** Persists a field list's order through the existing per-attribute patch route. */
export function useReorderAttributes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, attributeIds }: ReorderAttributesInput) =>
      Promise.all(attributeIds.map((attributeId, sortOrder) =>
        jsonFetch<PatchAttributeResponse>(`/api/orgs/${orgId}/attributes/${attributeId}`, {
          method: 'PATCH',
          body: JSON.stringify({ sortOrder }),
        }),
      )),
    onSettled: (_response, _error, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
