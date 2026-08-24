import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { GetCallCommentsResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

/** Loads the complete compact rail for one call. */
export function useGetCallComments(orgId: string | null | undefined, callId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.calls.comments(orgId ?? 'none', callId ?? 'none'),
    enabled: !!orgId && !!callId,
    queryFn: () => jsonFetch<GetCallCommentsResponse>(`/api/orgs/${orgId}/calls/${callId}/comments?limit=100`),
  })
}
