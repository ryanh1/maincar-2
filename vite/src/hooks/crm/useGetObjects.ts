import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetObjectsResponse } from '@/lib/crmTypes'

/** Every object this org has (standard and custom), for resolving a slug to an id. */
export function useGetObjects(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.objects.list(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetObjectsResponse>(`/api/orgs/${orgId}/objects`),
  })
}
