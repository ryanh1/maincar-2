import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetVoicemailsParams, GetVoicemailsResponse } from '@/lib/voicemailTypes'

function buildVoicemailsQuery(params: GetVoicemailsParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.q) search.set('q', params.q)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/** One server-paged, caller-searchable page of an organization's voicemail inbox. */
export function useGetVoicemails(
  orgId: string | null | undefined,
  params: GetVoicemailsParams = {},
) {
  return useQuery({
    queryKey: queryKeys.voicemails.list(orgId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      jsonFetch<GetVoicemailsResponse>(
        `/api/orgs/${orgId}/voicemails${buildVoicemailsQuery(params)}`,
      ),
  })
}
