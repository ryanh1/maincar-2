import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailDropsResponse } from '@/lib/voicemailDropTypes'

export function useGetVoicemailDrops(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.voicemailDrops.list(orgId ?? 'none'),
    enabled: Boolean(orgId),
    queryFn: () => jsonFetch<VoicemailDropsResponse>(`/api/orgs/${orgId}/voicemail-drops`),
  })
}
