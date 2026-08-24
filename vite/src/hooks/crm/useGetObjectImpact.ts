import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { GetObjectImpactResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

/** Counts records and inbound references before a custom object is deleted. */
export function useGetObjectImpact(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.objectImpact(orgId ?? 'none', objectId ?? 'none'),
    enabled: !!orgId && !!objectId,
    queryFn: () =>
      jsonFetch<GetObjectImpactResponse>(`/api/orgs/${orgId}/objects/${objectId}/impact`),
  })
}
