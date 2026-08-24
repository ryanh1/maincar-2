import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteAttributeInput {
  orgId: string
  objectId: string
  attributeId: string
}

/** Soft-deletes one custom field and refreshes every object-schema surface. */
export function useDeleteAttribute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, attributeId }: DeleteAttributeInput) =>
      jsonFetch<void>(`/api/orgs/${orgId}/attributes/${attributeId}`, { method: 'DELETE' }),
    onSuccess: (_response, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
