import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { RecordingPolicyResponse } from '@/lib/recordingPolicyTypes'

export function useGetRecordingPolicy(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.recordingPolicy(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<RecordingPolicyResponse>(`/api/orgs/${orgId}/settings/recording`),
  })
}
