import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallDetailResponse } from '@/lib/callTypes'

/**
 * One call in full — every field, its transcript, and a freshly signed link to
 * the recording.
 *
 * Both ids are needed to build the URL and both key the cache, because the
 * detail route scopes its lookup to the org AND the call: a real id in another
 * org is answered 404, so the cache entry is per-org too. The query stays idle
 * until both are known, so a detail view that mounts before its id resolves does
 * not request `/api/orgs/org-1/calls/undefined`.
 *
 * `refetchInterval` is off by default — a one-shot read for the detail page.
 * `DialerProvider` passes one while a call is live, so this same query doubles
 * as the channel that tells the browser what the server already knows about the
 * call's real status and duration (MAI-190).
 */
export function useGetCallDetail(
  orgId: string | null | undefined,
  callId: string | null | undefined,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.calls.detail(orgId ?? 'none', callId ?? 'none'),
    enabled: !!orgId && !!callId,
    queryFn: () => jsonFetch<CallDetailResponse>(`/api/orgs/${orgId}/calls/${callId}`),
    refetchInterval: options?.refetchInterval ?? false,
  })
}
