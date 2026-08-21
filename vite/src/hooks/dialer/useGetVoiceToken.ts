import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { VoiceTokenResponse } from '@/lib/callTypes'

/**
 * A short-lived credential for the rep's browser Voice SDK Device.
 *
 * Idle until an org is known, so a page that renders before the org resolves
 * does not request `/api/orgs/undefined/calls/voice-token`. Refetch is manual —
 * `DialerProvider` calls `refetch()` when the Device itself reports
 * `tokenWillExpire` — rather than time-based, because the Device's own warning is
 * the authoritative signal for when a fresh token is actually needed.
 */
export function useGetVoiceToken(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.calls.voiceToken(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<VoiceTokenResponse>(`/api/orgs/${orgId}/calls/voice-token`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
