import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { SavedViewsResponse } from './types'

/** Lists the signed-in rep's personal and visible Shared views for one object. */
export function useGetViews(orgId: string | null, objectId: string | null) {
  return useQuery({
    queryKey: queryKeys.savedViews.list(orgId ?? '', objectId ?? ''),
    queryFn: () => jsonFetch<SavedViewsResponse>(`/api/orgs/${orgId}/saved-views?objectId=${objectId}`),
    enabled: Boolean(orgId && objectId),
  })
}
