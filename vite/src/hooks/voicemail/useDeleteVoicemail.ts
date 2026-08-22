import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteVoicemailVariables {
  orgId: string
  id: string
}

/** Deletes the database row and its private recording, then refreshes voicemail data. */
export function useDeleteVoicemail() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, id }: DeleteVoicemailVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/voicemails/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.voicemails.all }),
  })
}
