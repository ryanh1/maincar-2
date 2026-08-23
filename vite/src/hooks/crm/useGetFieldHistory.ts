import { useInfiniteQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetFieldHistoryResponse } from '@/lib/crmTypes'

/** One cell's append-only field history, used by the change-highlight popover. */
export function useGetFieldHistory(
  orgId: string | null | undefined,
  recordId: string | null | undefined,
  attribute: string | null | undefined,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.records.fieldHistory(orgId ?? 'none', recordId ?? 'none', attribute ?? 'none'),
    enabled: !!orgId && !!recordId && !!attribute,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => jsonFetch<GetFieldHistoryResponse>(
      `/api/orgs/${orgId}/field-history?${new URLSearchParams({ recordId: recordId!, attribute: attribute!, ...(pageParam ? { cursor: pageParam } : {}) }).toString()}`,
    ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}
