import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { RemoveMemberInput } from './types'

/**
 * Offboard a member from one org.
 *
 * This ends their membership here. It does not delete the account and does not
 * touch any other organization they belong to.
 */
export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, userId }: RemoveMemberInput) =>
      jsonFetch<{ member: { userId: string; isActive: boolean } }>(
        `/api/orgs/${orgId}/members/${userId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.membersAll(variables.orgId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.invitations(variables.orgId) })
    },
  })
}
