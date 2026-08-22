import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetTeamsParams, GetTeamsResponse } from './types'

function buildTeamsQuery(params: GetTeamsParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort) search.set('sort', params.sort)
  if (params.dir) search.set('dir', params.dir)
  if (params.q) search.set('q', params.q)
  if (params.isArchived) search.set('isArchived', 'true')
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** One server-paged team catalog for the active organization. */
export function useGetTeams(orgId: string | null | undefined, params: GetTeamsParams = {}) {
  return useQuery({
    queryKey: queryKeys.teams.list(orgId ?? 'none', params as Record<string, unknown>),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
    queryFn: () => jsonFetch<GetTeamsResponse>(`/api/orgs/${orgId}/teams${buildTeamsQuery(params)}`),
  })
}
