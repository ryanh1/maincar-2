import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { SingleVoicemailGreetingResponse } from '@/lib/voicemailGreetingTypes'

export interface GreetingActionVariables { orgId: string; greetingId: string }

export function useActivateVoicemailGreeting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, greetingId }: GreetingActionVariables) =>
      jsonFetch<SingleVoicemailGreetingResponse>(`/api/orgs/${orgId}/voicemail-greeting/${greetingId}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voicemailGreeting.all }),
  })
}
