import { useInfiniteQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCrmListEntriesResponse } from '@/lib/crmTypes'

export const LIST_ENTRY_PAGE_LIMIT = 100

/**
 * The saved list’s paged membership read model. This hook deliberately exposes
 * no mutation: entry-only values remain distinct from the underlying record.
 */
export type ListEntrySort = 'position' | 'createdAt' | 'updatedAt'

export function useGetListEntries(orgId: string | null | undefined, listId: string | null | undefined, sort: ListEntrySort = 'position') {
  return useInfiniteQuery({
    queryKey: queryKeys.crm.listEntriesWithSort(orgId ?? 'none', listId ?? 'none', sort),
    enabled: !!orgId && !!listId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      jsonFetch<GetCrmListEntriesResponse>(
        `/api/orgs/${orgId}/lists/${listId}/entries?page=${pageParam}&limit=${LIST_ENTRY_PAGE_LIMIT}${sort === 'position' ? '' : `&sort=${sort}`}`,
      ),
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
  })
}
