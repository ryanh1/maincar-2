import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumberResponse } from '@/lib/phoneNumberTypes'

/**
 * What releasing a number sends. `orgId` travels in the variables, like every
 * other mutation in the app.
 */
export interface ReleaseNumberVariables {
  orgId: string
  /** The number to give back to Twilio. */
  id: string
}

/**
 * Give one number back to Twilio, so the organization stops paying for it.
 *
 * This is irreversible, so every caller puts it behind an `AlertDialog` that
 * names the number and says so.
 *
 * The server answers as soon as the row is marked `releasing`, not once Twilio
 * has confirmed — the release itself is a background job. So the row does not
 * vanish on success; it comes back reading "Releasing…" and disappears from a
 * later fetch. Invalidating the list here is what shows that first step.
 */
export function useReleaseNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, id }: ReleaseNumberVariables) =>
      jsonFetch<PhoneNumberResponse>(`/api/orgs/${orgId}/phone-numbers/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.list(variables.orgId),
      })
    },
  })
}
