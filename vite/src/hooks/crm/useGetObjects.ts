import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCrmObjectsResponse } from '@/lib/crmTypes'

/** Every object the signed-in organization can navigate to. */
export function useGetObjects(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.crm.objects(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetCrmObjectsResponse>(`/api/orgs/${orgId}/objects`),
  })
}
