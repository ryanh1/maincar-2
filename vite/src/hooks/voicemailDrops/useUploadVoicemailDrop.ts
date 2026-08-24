import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailDropResponse } from '@/lib/voicemailDropTypes'

export interface UploadVoicemailDropVariables {
  orgId: string
  name: string
  file: File
}

export function useUploadVoicemailDrop() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, name, file }: UploadVoicemailDropVariables) => {
      const body = new FormData()
      body.append('name', name)
      body.append('audio', file)
      return jsonFetch<VoicemailDropResponse>(`/api/orgs/${orgId}/voicemail-drops`, {
        method: 'POST',
        body,
      })
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({
      queryKey: queryKeys.voicemailDrops.all(variables.orgId),
    }),
  })
}
