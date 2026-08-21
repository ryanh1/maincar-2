import { useMutation } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { EmailDraftInput, EmailDraftResponse } from '@/lib/emailTypes'

/**
 * What opening a card sends. `orgId` travels in the variables rather than as a
 * hook argument, the way every other mutation in `hooks/orgs` does it, so the
 * hook never has to hold a possibly-null org between render and click.
 *
 * Every draft field is optional and normally absent: the row is created EMPTY
 * the moment the card opens. A composer opened from a record may pass its
 * recipient, and nothing else ever needs to.
 */
export interface CreateEmailDraftVariables extends EmailDraftInput {
  orgId: string
}

/**
 * Open a composer: create the draft row immediately, and normally empty.
 *
 * Creating up front is the whole reason autosave is safe. Every later keystroke
 * is a PATCH against an id that already exists, so no keystroke can race a
 * create and no card can be typed into before it has somewhere to save
 * (tasks/plan-email-composer.md → decision 2).
 *
 * Nothing is invalidated on success. The 201 carries the stored row, so the
 * dock adds exactly that card from the `mutateAsync` result; a refetch of the
 * drafts list would cost a round trip to learn what this response already said,
 * and would hand the provider server copies of the OTHER open cards — whose
 * text is still sitting in a 1200 ms debounce and is newer than anything saved.
 *
 * The 409 past 12 open drafts arrives as an `ApiError` carrying the server's own
 * sentence ("Close or discard one before starting another."). Show that, never a
 * rewrite of it: the server names the limit, and this hook must not guess it.
 */
export function useCreateEmailDraft() {
  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateEmailDraftVariables) =>
      jsonFetch<EmailDraftResponse>(`/api/email/orgs/${orgId}/drafts`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}
