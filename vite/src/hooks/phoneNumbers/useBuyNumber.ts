import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumberResponse } from '@/lib/phoneNumberTypes'

/**
 * What buying a number sends. `orgId` travels in the variables, like every other
 * mutation in the app, so the hook never holds a possibly-null org.
 */
export interface BuyNumberVariables {
  orgId: string
  /** The chosen number in E.164 form, e.g. "+12025550123". */
  e164: string
}

/**
 * Buy a number. The server writes a `searching` row and hands the purchase to a
 * background job, answering 201 straight away with that row — status stays
 * `searching` until the job turns it `active`.
 *
 * The numbers list is invalidated on success so the new `searching` row appears
 * without a manual refetch, ready for the UI to poll it to `active`.
 *
 * Not retried automatically: this queues a purchase that spends money.
 */
export function useBuyNumber() {
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    mutationFn: ({ orgId, e164 }: BuyNumberVariables) =>
      jsonFetch<PhoneNumberResponse>(`/api/orgs/${orgId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ e164 }),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.phoneNumbers.list(variables.orgId),
      })
    },
  })
}
