import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteVoicemailDropVariables {
  orgId: string
  dropId: string
}

export function useDeleteVoicemailDrop() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, dropId }: DeleteVoicemailDropVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/voicemail-drops/${dropId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({
      queryKey: queryKeys.voicemailDrops.all(variables.orgId),
    }),
  })
}
