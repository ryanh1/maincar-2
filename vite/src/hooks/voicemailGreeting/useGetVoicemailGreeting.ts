import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailGreetingResponse } from '@/lib/voicemailGreetingTypes'

export function useGetVoicemailGreeting(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.voicemailGreeting.detail(orgId ?? 'none'),
    enabled: Boolean(orgId),
    queryFn: () => jsonFetch<VoicemailGreetingResponse>(`/api/orgs/${orgId}/voicemail-greeting`),
    refetchInterval: (query) => query.state.data?.greeting.candidates.some((candidate) => (
      candidate.status === 'uploading' || candidate.status === 'transcoding'
    )) ? 3_000 : false,
  })
}
