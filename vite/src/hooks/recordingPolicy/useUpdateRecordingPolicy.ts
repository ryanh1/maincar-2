import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { RecordingPolicyPatch, RecordingPolicyResponse } from '@/lib/recordingPolicyTypes'

export function useUpdateRecordingPolicy(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: RecordingPolicyPatch) =>
      jsonFetch<RecordingPolicyResponse>(`/api/orgs/${orgId}/settings/recording`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.recordingPolicy(orgId), data)
    },
  })
}
