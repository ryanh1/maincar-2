import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { UpdateMemberRolesInput, UpdateMemberRolesResponse } from './types'

/**
 * Change one member's role set. Admin-only on the server, which also refuses to
 * edit the owner and to leave the org without an admin — the buttons this hook
 * sits behind only ever anticipate those answers.
 */
export function useUpdateMemberRoles() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, userId, roles }: UpdateMemberRolesInput) =>
      jsonFetch<UpdateMemberRolesResponse>(`/api/orgs/${orgId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roles }),
      }),
    onSuccess: (_data, variables) => {
      // Every page of the list, not just the one on screen: the admin count in
      // `meta` changed for all of them.
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.membersAll(variables.orgId) })
      // A role change can be the caller's own, and `useAuth` reads admin from it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() })
    },
  })
}
