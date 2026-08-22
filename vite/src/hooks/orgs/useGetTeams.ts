import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetTeamsParams, GetTeamsResponse } from './types'

/** Reads the active team catalog, or its archived entries when restoring a saved scope. */
export function useGetTeams(orgId: string | null | undefined, params: GetTeamsParams = {}) {
  const search = params.isArchived ? '?isArchived=true' : ''
  return useQuery({
    queryKey: queryKeys.orgs.teams(orgId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetTeamsResponse>(`/api/orgs/${orgId}/teams${search}`),
  })
}
