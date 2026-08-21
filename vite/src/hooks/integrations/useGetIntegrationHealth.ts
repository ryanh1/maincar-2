import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetIntegrationHealthResponse } from '@/lib/integrationTypes'

/**
 * What the app-wide badge counts: only the connections stamped `error`
 * (GET /api/integrations/orgs/:orgId/health).
 *
 * A `limited` connection is deliberately NOT here — a rep who granted reading but
 * refused sending made a choice, not a mistake, so counting it would train reps to
 * ignore the badge (SPEC-int-health.md). This returns `{ broken }`, newest-broken
 * first, and an empty list rather than a 404 when nothing is wrong.
 */
export function useGetIntegrationHealth(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false without
    // an org, so nothing is ever written under it.
    queryKey: queryKeys.integrations.health(orgId ?? 'none'),
    // No org means no URL to build, and the badge lives outside Settings where the
    // active org can still be resolving. Firing anyway would 403 on every render.
    enabled: !!orgId,
    queryFn: () =>
      jsonFetch<GetIntegrationHealthResponse>(`/api/integrations/orgs/${orgId}/health`),
  })
}
