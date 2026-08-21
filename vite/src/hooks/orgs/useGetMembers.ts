import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetMembersParams, GetMembersResponse } from './types'

/** The query string the server reads. Blank values are left out entirely. */
function buildMembersQuery(params: GetMembersParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort) search.set('sort', params.sort)
  if (params.dir) search.set('dir', params.dir)
  if (params.q) search.set('q', params.q)
  for (const role of params.role ?? []) search.append('role', role)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * One page of one org's members.
 *
 * Paging, sorting, and searching all happen on the SERVER, so the params are
 * part of the query key: an org with 500 members renders page one from a 25-row
 * response, never by fetching everything and slicing it here.
 *
 * `keepPreviousData` holds the current page on screen while the next one loads,
 * so paging does not blink through an empty table.
 */
export function useGetMembers(orgId: string | null | undefined, params: GetMembersParams = {}) {
  return useQuery({
    queryKey: queryKeys.orgs.members(orgId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      jsonFetch<GetMembersResponse>(`/api/orgs/${orgId}/members${buildMembersQuery(params)}`),
  })
}
