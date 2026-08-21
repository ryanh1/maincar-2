import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCrmListsResponse } from '@/lib/crmTypes'

/** The active lists the signed-in organization can navigate to. */
export function useGetLists(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.crm.lists(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetCrmListsResponse>(`/api/orgs/${orgId}/lists`),
  })
}
