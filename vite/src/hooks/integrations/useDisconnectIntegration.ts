import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

/** Which connection to disconnect, in which org. */
export interface DisconnectIntegrationVariables {
  orgId: string
  connectionId: string
}

/**
 * Disconnect a connection (DELETE /api/integrations/orgs/:orgId/:connectionId).
 *
 * The connection's `MailAccount` goes with it by cascade, so a mailbox never outlives
 * the grant it depends on. The button behind this sits inside an `AlertDialog` naming
 * the address and what stops working (SPEC-int-hub-ui.md AC 11) — this hook only fires
 * once that is confirmed.
 *
 * The DELETE route itself lands with IH-25; this hook is part of the barrel now so the
 * card and the tab can import it from `@/hooks/integrations` from the start. It reads
 * no response body — the card returns to "Not connected" off the invalidated refetch.
 *
 * Invalidation is on settle, keyed to `integrations.all(orgId)` — the prefix of both
 * the card list and the health badge — so a disconnected connection also clears from
 * the badge, and a failed delete still resyncs the cards against the server.
 */
export function useDisconnectIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, connectionId }: DisconnectIntegrationVariables) =>
      jsonFetch<void>(`/api/integrations/orgs/${orgId}/${connectionId}`, { method: 'DELETE' }),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.all(variables.orgId),
      })
    },
  })
}
