import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PatchAttributeRequest, PatchAttributeResponse } from '@/lib/crmTypes'

export type UpdateAttributeInput = PatchAttributeRequest & {
  orgId: string
  attributeId: string
  objectId: string
}

/** Patches one field's editable schema and refreshes every object-schema surface. */
export function useUpdateAttribute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId: _objectId, attributeId, ...attribute }: UpdateAttributeInput) =>
      jsonFetch<PatchAttributeResponse>(`/api/orgs/${orgId}/attributes/${attributeId}`, {
        method: 'PATCH',
        body: JSON.stringify(attribute),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.objects(variables.orgId) })
    },
  })
}
