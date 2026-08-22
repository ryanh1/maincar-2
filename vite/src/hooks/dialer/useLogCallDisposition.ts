import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CallDetailResponse, LogCallDispositionInput } from '@/lib/callTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useLogCallDisposition(orgId: string | null | undefined, callId: string | null | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LogCallDispositionInput) =>
      jsonFetch<CallDetailResponse>(`/api/orgs/${orgId}/calls/${callId}/disposition`, {
        method: 'PATCH', body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      if (!orgId || !callId) return
      queryClient.setQueryData(queryKeys.calls.detail(orgId, callId), data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.calls.list(orgId) })
    },
  })
}
