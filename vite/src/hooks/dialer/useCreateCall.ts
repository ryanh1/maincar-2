import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateCallInput, CreateCallResponse } from '@/lib/callTypes'
import { useDialer } from '@/components/dialer/dialerContext'

/**
 * What placing a call sends. `orgId` travels in the variables rather than as a
 * hook argument, the way every other mutation in the app does it, so the hook
 * never has to hold a possibly-null org between render and click.
 */
export interface CreateCallVariables extends CreateCallInput {
  orgId: string
}

/**
 * Place an outbound call: POST the number, then move the shared dialer into its
 * ringing state.
 *
 * The context transition happens on SUCCESS, not on submit: a call that the
 * server refused — no active number (400), a duplicate already in flight (409),
 * a bad number (400) — must never leave the dialer showing "ringing" for a call
 * that never started. The button's own pending state covers the round trip.
 *
 * The 409 carries the call already in flight, and adopting it into the dialer is
 * a later concern (the UI that shows an existing call owns that); here the
 * rejection simply surfaces through `ApiError` with the server's own sentence, so
 * the caller can toast exactly what the server said.
 *
 * The history list is invalidated on success so a placed call shows up in the
 * history table without a manual refetch.
 */
export function useCreateCall() {
  const queryClient = useQueryClient()
  const { startCall } = useDialer()

  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateCallVariables) =>
      jsonFetch<CreateCallResponse>(`/api/orgs/${orgId}/calls`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      startCall()
      void queryClient.invalidateQueries({ queryKey: queryKeys.calls.list(variables.orgId) })
    },
  })
}
