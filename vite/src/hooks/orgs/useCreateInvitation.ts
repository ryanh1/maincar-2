import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateInvitationInput, CreateInvitationResponse } from './types'

/** Invite someone to an org. Admin-only on the server. */
export function useCreateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateInvitationInput) =>
      jsonFetch<CreateInvitationResponse>(`/api/team/orgs/${orgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgs.invitations(variables.orgId),
      })
    },
  })
}
