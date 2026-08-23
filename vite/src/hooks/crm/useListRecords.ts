import { useInfiniteQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ListRecordsResponse, RecordSort } from '@/lib/crmTypes'
import type { RecordListFilter } from '@/components/crm/viewConfig'

export interface UseListRecordsParams {
  sort?: RecordSort[]
  filter?: RecordListFilter
  includeArchived?: boolean
}

/**
 * One object's rows, windowed by the server's keyset cursor (MAI-163) rather
 * than a page number: each fetch asks for "the next ~150 rows after this
 * cursor". `getNextPageParam` reads the cursor the server handed back, so a
 * sort change (a different query key) simply starts a fresh cursor instead of
 * reusing one that no longer matches the new order.
 */
export function useListRecords(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
  params: UseListRecordsParams = {},
) {
  return useInfiniteQuery({
    queryKey: queryKeys.records.list(orgId ?? 'none', objectId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId && !!objectId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      jsonFetch<ListRecordsResponse>(`/api/orgs/${orgId}/objects/${objectId}/list`, {
        method: 'POST',
        body: JSON.stringify({
          cursor: pageParam,
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.filter ? { filter: params.filter } : {}),
          ...(params.includeArchived ? { includeArchived: true } : {}),
        }),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}
