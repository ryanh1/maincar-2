import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetPublicInvitationResponse } from './types'

/**
 * What an invite link is for, read without signing in.
 *
 * No retry: every way this can fail — wrong token, expired, revoked, already
 * used — is a 404 that will still be a 404 three attempts later, and retrying
 * only spends the rate limit.
 */
export function useGetPublicInvitation(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.invitations.public(token ?? 'none'),
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      const data = await jsonFetch<GetPublicInvitationResponse>(
        `/api/public/invitations/${encodeURIComponent(token!)}`,
      )
      return data.invitation
    },
  })
}
