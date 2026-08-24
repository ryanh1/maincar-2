import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { PatchObjectRequest, PatchObjectResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export type UpdateObjectInput = PatchObjectRequest & {
  orgId: string
  objectId: string
}

/** Patches one record type's editable schema and refreshes every object-identity surface. */
export function useUpdateObject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId, ...object }: UpdateObjectInput) =>
      jsonFetch<PatchObjectResponse>(`/api/orgs/${orgId}/objects/${objectId}`, {
        method: 'PATCH',
        body: JSON.stringify(object),
      }),
    onSuccess: (_response, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
