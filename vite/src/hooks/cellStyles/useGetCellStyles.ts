import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { CellStylesResponse } from './types'

/** Lists every painted cell in one view, so the grid can tint them on render. */
export function useGetCellStyles(orgId: string | null, viewId: string | null) {
  return useQuery({
    queryKey: queryKeys.cellStyles.list(orgId ?? '', viewId ?? ''),
    queryFn: () => jsonFetch<CellStylesResponse>(`/api/orgs/${orgId}/cell-styles?viewId=${viewId}`),
    enabled: Boolean(orgId && viewId),
  })
}
