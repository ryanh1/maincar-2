import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetMailboxesResponse } from '@/lib/mailboxTypes'

/**
 * This rep's send-from addresses for one org (GET /api/mailboxes/orgs/:orgId).
 *
 * The server scopes the list to `(orgId, userId)` and returns it oldest first, each
 * mailbox carrying its parent connection's status so a row can show its own trouble.
 * The client reads that array straight through — it never owns the ordering, the
 * provider labels, or which one is primary.
 */
export function useGetMailboxes(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false without an
    // org, so nothing is ever written under it.
    queryKey: queryKeys.mailboxes.list(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/mailboxes/orgs/null and take a 403 on every render before sign-in finishes
    // resolving which org the rep is in.
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetMailboxesResponse>(`/api/mailboxes/orgs/${orgId}`),
  })
}
