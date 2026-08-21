import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetCallsParams, GetCallsResponse } from '@/lib/callTypes'

/** The query string the server reads. Blank and default values are left out. */
function buildCallsQuery(params: GetCallsParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort) search.set('sort', params.sort)
  if (params.dir) search.set('dir', params.dir)
  if (params.q) search.set('q', params.q)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * One page of an org's call history.
 *
 * Paging, sorting, and searching all happen on the SERVER, so the params are
 * part of the query key: an org with thousands of calls renders page one from a
 * 25-row response, never by fetching everything and slicing it here.
 *
 * `keepPreviousData` holds the current page on screen while the next one loads,
 * so paging does not blink through an empty table.
 */
export function useGetCalls(orgId: string | null | undefined, params: GetCallsParams = {}) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: queryKeys.calls.list(orgId ?? 'none', params as Record<string, unknown>),
    // No org means no URL to build. Firing anyway would request
    // /api/orgs/null/calls and take a 404 before sign-in resolves the org.
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      jsonFetch<GetCallsResponse>(`/api/orgs/${orgId}/calls${buildCallsQuery(params)}`),
  })
}
