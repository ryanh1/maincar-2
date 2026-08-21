import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

/** Revoke a pending invitation. Admin-only on the server. */
export function useRevokeInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, invitationId }: { orgId: string; invitationId: string }) =>
      jsonFetch<{ invitation: { id: string; status: string } }>(
        `/api/team/orgs/${orgId}/invitations/${invitationId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgs.invitations(variables.orgId),
      })
    },
  })
}
