import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumberResponse } from '@/lib/phoneNumberTypes'

/**
 * What choosing the active caller ID sends. `orgId` travels in the variables,
 * like every other mutation in the app.
 */
export interface SetActiveNumberVariables {
  orgId: string
  /** The number to make active. */
  id: string
}

/**
 * Make one number the org's active outbound caller ID.
 *
 * This is a radio button, not a checkbox: picking one number un-picks the rest,
 * so the request only ever sends `isActiveForOutbound: true`. Turning the active
 * number off is refused by the server (400) — the only way out of a number is
 * into another one.
 *
 * The numbers list is invalidated on success so the picker reflects the switch —
 * the newly active row and the one it replaced — without a manual refetch.
 */
export function useSetActiveNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, id }: SetActiveNumberVariables) =>
      jsonFetch<PhoneNumberResponse>(`/api/orgs/${orgId}/phone-numbers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActiveForOutbound: true }),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.list(variables.orgId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.orgList(variables.orgId),
      })
    },
  })
}
