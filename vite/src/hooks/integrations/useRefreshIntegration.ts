import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ConnectionResponse } from '@/lib/integrationTypes'

/** Which connection to refresh, in which org. */
export interface RefreshIntegrationVariables {
  orgId: string
  connectionId: string
}

/**
 * Re-read a connection's granted scopes with no consent screen
 * (POST /api/integrations/orgs/:orgId/:connectionId/refresh).
 *
 * This is how a `limited` card moves to `connected` after an admin grants the missing
 * scope: no popup, just a fresh token and a re-evaluated status. The server returns
 * `{ connection }`, the token-free row.
 *
 * Invalidation is on settle, keyed to `integrations.all(orgId)` — the prefix of both
 * the card list and the health badge — and fires even on failure so the cards never
 * keep showing a status the refresh has already superseded.
 */
export function useRefreshIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, connectionId }: RefreshIntegrationVariables) =>
      jsonFetch<ConnectionResponse>(
        `/api/integrations/orgs/${orgId}/${connectionId}/refresh`,
        { method: 'POST' },
      ),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.all(variables.orgId),
      })
    },
  })
}
