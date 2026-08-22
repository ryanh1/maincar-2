import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { SingleVoicemailGreetingResponse } from '@/lib/voicemailGreetingTypes'

export interface UploadVoicemailGreetingVariables {
  orgId: string
  file: File
  idempotencyKey: string
}

export function useUploadVoicemailGreeting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, file, idempotencyKey }: UploadVoicemailGreetingVariables) => {
      const body = new FormData()
      body.append('audio', file)
      return jsonFetch<SingleVoicemailGreetingResponse>(`/api/orgs/${orgId}/voicemail-greeting`, {
        method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voicemailGreeting.all }),
  })
}
