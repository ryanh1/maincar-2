import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetIntegrationsResponse } from '@/lib/integrationTypes'

/**
 * One card per PROVIDER for this org, built server-side (GET /api/integrations/orgs/:orgId).
 *
 * The client never owns the provider list, the labels, or the permission copy — the
 * server sends `integrations` with one entry per provider, each carrying its own
 * `providerLabel`, `requiredPermissions`, and `connection` (`null` when nothing is
 * connected). The card reads that array straight through.
 */
export function useGetIntegrations(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false without
    // an org, so nothing is ever written under it.
    queryKey: queryKeys.integrations.list(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/integrations/orgs/null and take a 403 on every render before sign-in
    // finishes resolving which org the rep is in.
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetIntegrationsResponse>(`/api/integrations/orgs/${orgId}`),
  })
}
