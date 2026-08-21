import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallDetailResponse } from '@/lib/callTypes'
import { useDialer } from '@/components/dialer/dialerContext'

/** Which call to hang up, in which org. */
export interface EndCallVariables {
  orgId: string
  callId: string
}

/**
 * Hang up a live call: DELETE it, then move the shared dialer into its completed
 * state, which stops the timer and freezes the elapsed time at the call's final
 * length.
 *
 * The context transition happens on SUCCESS: if the hang-up is refused — the
 * call already ended (400), or was never this org's to end (404) — the dialer's
 * state is left as it was rather than falsely marked completed, and the rejection
 * surfaces through `ApiError` with the server's own message.
 *
 * The history list and this call's detail are invalidated on success, because the
 * DELETE settled the row to `canceled` with an `endedAt` and both views now hold
 * a stale copy.
 */
export function useEndCall() {
  const queryClient = useQueryClient()
  const { endCall } = useDialer()

  return useMutation({
    mutationFn: ({ orgId, callId }: EndCallVariables) =>
      jsonFetch<CallDetailResponse>(`/api/orgs/${orgId}/calls/${callId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => {
      endCall()
      void queryClient.invalidateQueries({ queryKey: queryKeys.calls.list(variables.orgId) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calls.detail(variables.orgId, variables.callId),
      })
    },
  })
}
