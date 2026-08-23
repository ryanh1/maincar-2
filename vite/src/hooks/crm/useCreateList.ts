import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CrmList } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface CreateListInput {
  orgId: string
  name: string
  objectSlug: string
}

export interface CreateListResponse {
  list: CrmList
}

/** Creates an object-scoped list and refreshes the navigation inventory. */
export function useCreateList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, name, objectSlug }: CreateListInput) =>
      jsonFetch<CreateListResponse>(`/api/orgs/${orgId}/lists`, {
        method: 'POST',
        body: JSON.stringify({ name, objectSlug }),
      }),
    onSuccess: (_response, { orgId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.lists(orgId) }),
  })
}
