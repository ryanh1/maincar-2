import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CallDetailResponse } from '@/lib/callTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface SaveCallNoteInput {
  noteText: string
}

/** Saves the in-call scratchpad without changing the call's business outcome. */
export function useSaveCallNote(orgId: string | null | undefined, callId: string | null | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SaveCallNoteInput) =>
      jsonFetch<CallDetailResponse>(`/api/orgs/${orgId}/calls/${callId}/note`, {
        method: 'PATCH', body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      if (!orgId || !callId) return
      queryClient.setQueryData(queryKeys.calls.detail(orgId, callId), data)
    },
  })
}
