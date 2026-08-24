import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailDropResponse } from '@/lib/voicemailDropTypes'

export interface SetDefaultVoicemailDropVariables {
  orgId: string
  dropId: string
}

export function useSetDefaultVoicemailDrop() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, dropId }: SetDefaultVoicemailDropVariables) =>
      jsonFetch<VoicemailDropResponse>(`/api/orgs/${orgId}/voicemail-drops/${dropId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({
      queryKey: queryKeys.voicemailDrops.all(variables.orgId),
    }),
  })
}
