import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CreateObjectRequest, CreateObjectResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export type CreateObjectInput = CreateObjectRequest & {
  orgId: string
}

/** Creates one custom record type and refreshes every object-identity surface. */
export function useCreateObject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, ...object }: CreateObjectInput) =>
      jsonFetch<CreateObjectResponse>(`/api/orgs/${orgId}/objects`, {
        method: 'POST',
        body: JSON.stringify(object),
      }),
    onSuccess: (_response, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
