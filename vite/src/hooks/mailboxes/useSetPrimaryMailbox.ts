import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { MailboxListResponse } from '@/lib/mailboxTypes'

/** Which mailbox to promote, in which org. `orgId` travels in the variables like every mutation. */
export interface SetPrimaryMailboxVariables {
  orgId: string
  mailboxId: string
}

/**
 * Promote a mailbox to primary (POST /api/mailboxes/orgs/:orgId/:mailboxId/primary).
 *
 * The server moves the flag inside one transaction and returns the WHOLE list, because
 * "exactly one is primary" is a property of the SET — returning the single changed row
 * would let the client render two primaries between responses. So on success we write
 * that whole list STRAIGHT into the cache (`setQueryData`), not invalidate-and-refetch:
 * the composer's sender picker reads the promoted address the instant the request
 * lands, with no window in which the badge shows two primaries or none.
 *
 * A failed promote writes nothing, so the previous list stays intact and the rep's
 * current primary is unchanged.
 */
export function useSetPrimaryMailbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, mailboxId }: SetPrimaryMailboxVariables) =>
      jsonFetch<MailboxListResponse>(
        `/api/mailboxes/orgs/${orgId}/${mailboxId}/primary`,
        { method: 'POST' },
      ),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(queryKeys.mailboxes.list(variables.orgId), data)
    },
  })
}
