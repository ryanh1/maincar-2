import { useMemo } from 'react'

import { useListRecords } from './useListRecords'
import type { UseListRecordsParams } from './useListRecords'

/**
 * Flattens the infinite query's pages into one row array for the grid to index
 * by row number. `totalCount` comes from the most recent page rather than the
 * first: it is the same number on every page (the server recomputes it fresh
 * each time), so the latest one is no less current than page one would be.
 */
export function useRecordWindow(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
  params: UseListRecordsParams = {},
) {
  const query = useListRecords(orgId, objectId, params)

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data])
  const lastPage = query.data?.pages[query.data.pages.length - 1]

  return {
    rows,
    totalCount: lastPage?.totalCount ?? 0,
    isPending: query.isPending,
    isError: query.isError,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  }
}
