import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { MailboxListResponse } from '@/lib/mailboxTypes'

/** Which mailbox to disconnect, in which org. `orgId` travels in the variables. */
export interface DisconnectMailboxVariables {
  orgId: string
  mailboxId: string
}

/**
 * Disconnect a mailbox (DELETE /api/mailboxes/orgs/:orgId/:mailboxId).
 *
 * If the deleted mailbox was primary, the server promotes the newest remaining one in
 * the same transaction and returns the WHOLE remaining list — never leaving the rep with
 * mailboxes and no primary. So on success we write that list STRAIGHT into the cache
 * (`setQueryData`), like promote: the composer's sender picker follows the promotion the
 * instant the request lands, with no window in which the badge shows two primaries or
 * none. The button behind this sits inside an `AlertDialog` naming the address; this
 * hook fires only once that is confirmed.
 *
 * A failed delete writes nothing, so the previous list stays intact and the row survives.
 */
export function useDisconnectMailbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, mailboxId }: DisconnectMailboxVariables) =>
      jsonFetch<MailboxListResponse>(`/api/mailboxes/orgs/${orgId}/${mailboxId}`, {
        method: 'DELETE',
      }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(queryKeys.mailboxes.list(variables.orgId), data)
    },
  })
}
