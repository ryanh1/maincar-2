import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { ObjectDef } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface CreateObjectInput {
  orgId: string
  slug: string
  name: string
  namePlural: string
  icon: string
}

interface ObjectResponse {
  object: ObjectDef
}

/** Creates one custom record type and refreshes every object-identity surface. */
export function useCreateObject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, ...object }: CreateObjectInput) =>
      jsonFetch<ObjectResponse>(`/api/orgs/${orgId}/objects`, {
        method: 'POST',
        body: JSON.stringify(object),
      }),
    onSuccess: (_response, { orgId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.objects.list(orgId) }),
  })
}
