import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { AttributeDef, FieldFormat, FieldValidation } from '@/lib/crmTypes'

export interface UpdateAttributeInput {
  orgId: string
  attributeId: string
  objectId: string
  formatJson?: FieldFormat
  validationJson?: FieldValidation
}

interface UpdateAttributeResponse {
  attribute: AttributeDef
}

/**
 * Saves a field's Format & validation config (MAI-365) through the attribute
 * route, then refreshes the object detail so the field list reflects the change.
 */
export function useUpdateAttribute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, attributeId, formatJson, validationJson }: UpdateAttributeInput) =>
      jsonFetch<UpdateAttributeResponse>(`/api/orgs/${orgId}/attributes/${attributeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ formatJson, validationJson }),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(variables.orgId, variables.objectId) })
    },
  })
}
