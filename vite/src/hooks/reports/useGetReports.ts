import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetReportsResponse } from '@/lib/reportTypes'

export interface GetReportsParams {
  page?: number
  limit?: number
}

function buildReportsQuery(params: GetReportsParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit && params.limit !== 50) search.set('limit', String(params.limit))
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** Every non-trashed report owned by the active rep in this organization. */
export function useGetReports(orgId: string | null | undefined, params: GetReportsParams = {}) {
  return useQuery({
    queryKey: queryKeys.reports.list(orgId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetReportsResponse>(`/api/orgs/${orgId}/reports${buildReportsQuery(params)}`),
  })
}
