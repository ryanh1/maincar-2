import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetMembersResponse } from './types'

/** The members of one org. Keyed by orgId so a switch reads a different entry. */
export function useGetMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.orgs.members(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: async () => {
      const data = await jsonFetch<GetMembersResponse>(`/api/team/orgs/${orgId}/members`)
      return data
    },
  })
}
