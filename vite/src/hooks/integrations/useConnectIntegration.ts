import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { AuthorizeResponse } from '@/lib/integrationTypes'
import type { Provider } from '@/lib/integrationTypes'

/**
 * The two ways a rep starts consent. `connect` asks for every permission Maincar
 * needs; `fix` asks for ONLY the ones a `limited` connection is still missing, so
 * the amber card's one button re-consents to just that (SPEC-int-oauth.md § API).
 */
export type ConnectMode = 'connect' | 'fix'

/**
 * What starting a connection sends. `orgId` travels in the variables, like every
 * other mutation in the app, so the hook never holds a possibly-null org. `mode:
 * 'fix'` carries the `connectionId` of the connection being repaired.
 */
export interface ConnectIntegrationVariables {
  orgId: string
  provider: Provider
  mode: ConnectMode
  /** Required for `mode: 'fix'` — the connection whose missing scopes to re-request. */
  connectionId?: string
}

/**
 * Start consent: ask the server for the provider's authorize URL
 * (POST /api/integrations/orgs/:orgId/:provider/authorize).
 *
 * This mutation returns `{ url }` and NOTHING is connected yet — the grant is written
 * when the popup lands on the callback. The Integrations tab (IH-24) opens the popup
 * SYNCHRONOUSLY inside the click, then sets its URL from this result, because opening
 * the window after the `await` is exactly what a pop-up blocker stops.
 *
 * Invalidation is on settle, keyed to `integrations.all(orgId)` — a prefix of both the
 * card list and the health badge, so one call refreshes both. It fires even on failure
 * so a partially-started attempt never leaves the cards showing a stale row.
 */
export function useConnectIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    // Not retried: this starts an interactive consent the rep is watching, and a
    // silent second authorize would race the popup the first one opened.
    retry: false,
    mutationFn: ({ orgId, provider, mode, connectionId }: ConnectIntegrationVariables) =>
      jsonFetch<AuthorizeResponse>(`/api/integrations/orgs/${orgId}/${provider}/authorize`, {
        method: 'POST',
        body: JSON.stringify({ mode, connectionId }),
      }),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.all(variables.orgId),
      })
    },
  })
}
