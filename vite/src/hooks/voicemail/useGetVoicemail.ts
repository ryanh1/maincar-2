import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailResponse } from '@/lib/voicemailTypes'

/** Reads one org-scoped voicemail only after both pieces of its route are known. */
export function useGetVoicemail(
  orgId: string | null | undefined,
  voicemailId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.voicemails.detail(orgId ?? 'none', voicemailId ?? 'none'),
    enabled: !!orgId && !!voicemailId,
    queryFn: () => jsonFetch<VoicemailResponse>(`/api/orgs/${orgId}/voicemails/${voicemailId}`),
  })
}
