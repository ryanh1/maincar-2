import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { AcceptInvitationResponse } from './types'

/**
 * Turn an invite token into a membership. The caller must already be signed in.
 *
 * The whole cache is cleared on success, not one key: the signed-in identity now
 * belongs to a different org, so nothing read before this call is trustworthy.
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (token: string) =>
      jsonFetch<AcceptInvitationResponse>(
        `/api/invitations/${encodeURIComponent(token)}/accept`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.clear()
    },
  })
}
