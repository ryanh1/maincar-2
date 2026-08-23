import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { AttributeDef, AttributeType } from '@/lib/crmTypes'

export interface CreateListAttributeInput {
  orgId: string
  objectId: string
  name: string
  slug: string
  type: AttributeType
}

/** Creates a membership-scoped field. It never adds a value to the underlying record. */
export function useCreateListAttribute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId, name, slug, type }: CreateListAttributeInput) =>
      jsonFetch<{ attribute: AttributeDef }>(`/api/orgs/${orgId}/attributes`, {
        method: 'POST',
        body: JSON.stringify({ objectId, name, slug, type, storage: 'list' }),
      }),
    onSuccess: (_response, { orgId, objectId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(orgId, objectId) }),
  })
}
