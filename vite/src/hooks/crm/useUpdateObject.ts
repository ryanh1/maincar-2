import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { ObjectDef } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface UpdateObjectInput {
  orgId: string
  objectId: string
  name: string
  namePlural: string
  icon: string
}

interface ObjectResponse {
  object: ObjectDef
}

/** Updates one record type's visible identity and refreshes list and detail caches. */
export function useUpdateObject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId, ...object }: UpdateObjectInput) =>
      jsonFetch<ObjectResponse>(`/api/orgs/${orgId}/objects/${objectId}`, {
        method: 'PATCH',
        body: JSON.stringify(object),
      }),
    onSuccess: (_response, { orgId, objectId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.list(orgId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(orgId, objectId) })
    },
  })
}
