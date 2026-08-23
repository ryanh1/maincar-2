import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetRelatedRecordsResponse } from '@/lib/crmTypes'

/** Loads the small related-record graph used by one peek level. */
export function useGetRelatedRecords(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.records.related(orgId ?? 'none', objectId ?? 'none', recordId ?? 'none'),
    enabled: !!orgId && !!objectId && !!recordId,
    queryFn: () => jsonFetch<GetRelatedRecordsResponse>(`/api/orgs/${orgId}/objects/${objectId}/records/${recordId}/related`),
  })
}
