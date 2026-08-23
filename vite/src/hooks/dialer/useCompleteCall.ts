import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CompleteCallInput, CompleteCallResponse } from '@/lib/callTypes'
import { queryKeys } from '@/lib/queryKeys'

/** Saves a call’s outcome, notes, next steps, and task-creating follow-ups together. */
export function useCompleteCall(orgId: string | null | undefined, callId: string | null | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CompleteCallInput) =>
      jsonFetch<CompleteCallResponse>(`/api/orgs/${orgId}/calls/${callId}/complete`, {
        method: 'POST', body: JSON.stringify(input),
      }),
    onSuccess: () => {
      if (!orgId || !callId) return
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.calls.detail(orgId, callId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calls.list(orgId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(orgId) }),
      ])
    },
  })
}
