import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetObjectResponse } from '@/lib/crmTypes'

/** One object with its live attribute set — what the grid needs to draw columns. */
export function useGetObject(orgId: string | null | undefined, objectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.objects.detail(orgId ?? 'none', objectId ?? 'none'),
    enabled: !!orgId && !!objectId,
    queryFn: () => jsonFetch<GetObjectResponse>(`/api/orgs/${orgId}/objects/${objectId}`),
  })
}
