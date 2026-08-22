import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GreetingActionVariables } from './useActivateVoicemailGreeting'

export function useDeleteVoicemailGreeting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, greetingId }: GreetingActionVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/voicemail-greeting/${greetingId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voicemailGreeting.all }),
  })
}
