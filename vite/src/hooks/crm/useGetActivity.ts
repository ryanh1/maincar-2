import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetActivityResponse } from '@/lib/crmTypes'

export type ActivityScope =
  | { companyId: string }
  | { personId: string }
  | { dealId: string }

/**
 * One record's activity feed (`GET /api/orgs/:orgId/activity`, MAI-140), scoped to
 * exactly one of company/person/deal. Page one only — the peek drawer's read-only
 * scaffold (MAI-167) doesn't scroll the feed yet.
 */
export function useGetActivity(orgId: string | null | undefined, scope: ActivityScope | null) {
  const params = scope ? new URLSearchParams(scope as Record<string, string>) : null

  return useQuery({
    queryKey: queryKeys.activity.list(orgId ?? 'none', scope ?? {}, 1),
    enabled: !!orgId && !!scope,
    queryFn: () => jsonFetch<GetActivityResponse>(`/api/orgs/${orgId}/activity?${params!.toString()}`),
  })
}
