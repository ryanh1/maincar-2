import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { MailboxResponse } from '@/lib/mailboxTypes'

/**
 * A rename of one mailbox. `displayName` is the rep's private label, `null` to clear it.
 * `orgId` travels in the variables, like every mutation, so the hook never holds a
 * possibly-null org.
 */
export interface UpdateMailboxVariables {
  orgId: string
  mailboxId: string
  displayName: string | null
}

/**
 * Rename a mailbox (PATCH /api/mailboxes/orgs/:orgId/:mailboxId).
 *
 * The server validates and caps the name and returns the one updated row. A rename does
 * not touch the primary flag, so there is no set-wide invariant to preserve here —
 * unlike promote and delete, this cannot return the whole list. So invalidation is on
 * settle, keyed to `mailboxes.all(orgId)` (the prefix of the list), which resyncs the
 * list against the server. It fires even on failure so a rejected rename still re-reads
 * the server's truth rather than leaving a half-applied name in view.
 */
export function useUpdateMailbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, mailboxId, displayName }: UpdateMailboxVariables) =>
      jsonFetch<MailboxResponse>(`/api/mailboxes/orgs/${orgId}/${mailboxId}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      }),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.mailboxes.all(variables.orgId),
      })
    },
  })
}
