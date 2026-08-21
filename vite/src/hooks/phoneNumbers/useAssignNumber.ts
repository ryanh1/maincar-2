import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { OrgPhoneNumberResponse } from '@/lib/phoneNumberTypes'

/**
 * What assigning, reassigning, or unassigning a number sends. One route covers
 * all three: `userId` is the new holder, and `null` takes the number back.
 */
export interface AssignNumberVariables {
  orgId: string
  /** The number changing hands. */
  id: string
  /** The new holder, or `null` to leave the number unassigned. */
  userId: string | null
}

/**
 * Give a number to a member, hand it from one member to another, or take it
 * back to the organization.
 *
 * The server always clears `isActiveForOutbound` on a handover — the flag meant
 * "this is the OLD holder's caller ID", and carrying it across would risk a
 * second active number for whoever receives it. Both the org-wide list and the
 * caller's own list are invalidated: a caller ID the admin just moved away from
 * this browser's user has to disappear from their own pane too.
 */
export function useAssignNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, id, userId }: AssignNumberVariables) =>
      jsonFetch<OrgPhoneNumberResponse>(`/api/orgs/${orgId}/phone-numbers/${id}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedUserId: userId }),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.orgList(variables.orgId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.list(variables.orgId),
      })
    },
  })
}
