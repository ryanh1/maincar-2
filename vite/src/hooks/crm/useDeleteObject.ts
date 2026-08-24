import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteObjectInput {
  orgId: string
  objectId: string
}

/** Soft-deletes one custom object and refreshes every object-identity surface. */
export function useDeleteObject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId }: DeleteObjectInput) =>
      jsonFetch<void>(`/api/orgs/${orgId}/objects/${objectId}`, { method: 'DELETE' }),
    onSuccess: (_response, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
