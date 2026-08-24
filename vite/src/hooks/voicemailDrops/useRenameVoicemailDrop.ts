import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailDropResponse } from '@/lib/voicemailDropTypes'

export interface RenameVoicemailDropVariables {
  orgId: string
  dropId: string
  name: string
}

export function useRenameVoicemailDrop() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, dropId, name }: RenameVoicemailDropVariables) =>
      jsonFetch<VoicemailDropResponse>(`/api/orgs/${orgId}/voicemail-drops/${dropId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({
      queryKey: queryKeys.voicemailDrops.all(variables.orgId),
    }),
  })
}
