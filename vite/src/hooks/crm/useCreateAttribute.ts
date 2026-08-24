import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CreateAttributeRequest, CreateAttributeResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export type CreateAttributeInput = CreateAttributeRequest & { orgId: string }

/** Creates one field and refreshes every object-schema surface. */
export function useCreateAttribute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, ...attribute }: CreateAttributeInput) =>
      jsonFetch<CreateAttributeResponse>(`/api/orgs/${orgId}/attributes`, {
        method: 'POST',
        body: JSON.stringify(attribute),
      }),
    onSuccess: (_response, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(orgId) })
    },
  })
}
