import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { TestConnectionResponse } from '@/lib/integrationTypes'

/** Which connection to test, in which org. */
export interface TestIntegrationVariables {
  orgId: string
  connectionId: string
}

/**
 * Test a connection (POST /api/integrations/orgs/:orgId/:connectionId/test).
 *
 * The server probes each capability independently and returns `{ result }` with a
 * verdict PER capability, never a bare boolean, so the card names WHICH permission is
 * broken rather than a flat "Test failed". A broken integration is 200 with
 * `ok: false`, not a 500 — it is an expected state (SPEC-int-health.md § API).
 *
 * Test is a repair of the record: the server writes the verdict back to the row. So
 * invalidation is on settle, keyed to `integrations.all(orgId)` — the prefix of the
 * card list and the health badge — and fires even on a rejected request so the cards
 * re-read the just-written status either way.
 */
export function useTestIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, connectionId }: TestIntegrationVariables) =>
      jsonFetch<TestConnectionResponse>(
        `/api/integrations/orgs/${orgId}/${connectionId}/test`,
        { method: 'POST' },
      ),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.all(variables.orgId),
      })
    },
  })
}
