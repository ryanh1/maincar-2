import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetInvitationsResponse } from './types'

/**
 * Pending invitations for one org. Admin-only on the server, so `enabled` takes
 * an `isAdmin` flag: a member must not fire a request that will only 403.
 */
export function useGetInvitations(orgId: string | null | undefined, isAdmin: boolean) {
  return useQuery({
    queryKey: queryKeys.orgs.invitations(orgId ?? 'none'),
    enabled: !!orgId && isAdmin,
    queryFn: async () => {
      const data = await jsonFetch<GetInvitationsResponse>(`/api/team/orgs/${orgId}/invitations`)
      return data.invitations
    },
  })
}
