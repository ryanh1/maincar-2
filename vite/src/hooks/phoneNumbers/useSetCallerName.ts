import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumberResponse } from '@/lib/phoneNumberTypes'

/** The requested caller-ID name for the caller's selected outbound number. */
export interface SetCallerNameVariables {
  orgId: string
  id: string
  isCallerNameRequested: boolean
  /** Required when switching the request on; retained server-side when switching it off. */
  callerName?: string
}

/** Save or withdraw the carrier-facing caller-ID-name request for one number. */
export function useSetCallerName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, id, ...body }: SetCallerNameVariables) =>
      jsonFetch<PhoneNumberResponse>(`/api/orgs/${orgId}/phone-numbers/${id}/caller-name`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.phoneNumbers.list(variables.orgId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.phoneNumbers.orgList(variables.orgId) })
    },
  })
}
