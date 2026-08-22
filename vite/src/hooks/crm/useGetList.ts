import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCrmListResponse } from '@/lib/crmTypes'

/** One saved list, addressed directly so the route is never limited by the sidebar page. */
export function useGetList(orgId: string | null | undefined, listId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.crm.list(orgId ?? 'none', listId ?? 'none'),
    enabled: !!orgId && !!listId,
    queryFn: () => jsonFetch<GetCrmListResponse>(`/api/orgs/${orgId}/lists/${listId}`),
  })
}
