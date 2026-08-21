import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateInvitationResponse } from './types'

/**
 * Mint a new link for a pending invite. Admin-only on the server.
 *
 * The old link stops working the moment this returns, which is the point: it is
 * what an admin presses after sending the link to the wrong person.
 */
export function useRegenerateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, invitationId }: { orgId: string; invitationId: string }) =>
      jsonFetch<CreateInvitationResponse>(
        `/api/team/orgs/${orgId}/invitations/${invitationId}/regenerate`,
        { method: 'POST' },
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgs.invitations(variables.orgId),
      })
    },
  })
}
