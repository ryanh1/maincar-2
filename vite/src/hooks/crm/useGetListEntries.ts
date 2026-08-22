import { useInfiniteQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCrmListEntriesResponse } from '@/lib/crmTypes'

export const LIST_ENTRY_PAGE_LIMIT = 100

/**
 * The saved list’s paged membership read model. This hook deliberately exposes
 * no mutation: entry-only values remain distinct from the underlying record.
 */
export function useGetListEntries(orgId: string | null | undefined, listId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.crm.listEntries(orgId ?? 'none', listId ?? 'none'),
    enabled: !!orgId && !!listId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      jsonFetch<GetCrmListEntriesResponse>(
        `/api/orgs/${orgId}/lists/${listId}/entries?page=${pageParam}&limit=${LIST_ENTRY_PAGE_LIMIT}`,
      ),
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
  })
}
