import { useMutation } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'

/** What a successful send returns (SPEC-composer-send.md → API). */
export interface SentEmailMessage {
  id: string
  providerMsgId: string
  threadId: string | null
  sentAt: string
}

export interface SendEmailDraftResponse {
  /** `null` when the provider accepted the send but returned no message receipt. */
  message: SentEmailMessage | null
  accepted: true
}

/** Which draft to send, in which org. The route takes no other input. */
export interface SendEmailDraftVariables {
  orgId: string
  draftId: string
}

/**
 * Send a draft. The route reads the draft it already owns rather than taking a
 * payload, so what goes out is exactly what was last autosaved
 * (SPEC-composer-send.md → API).
 *
 * A 409 means no mailbox is connected, a 400 names a bad recipient, and a 502
 * means the provider refused — all three reject with an `ApiError` carrying
 * the server's own message, and the draft is untouched on every one of them.
 * On success the server has already deleted the draft row; the caller is
 * responsible for dropping the card (`useComposer().discardDraft`), not this
 * hook.
 */
export function useSendEmailDraft() {
  return useMutation({
    mutationFn: ({ orgId, draftId }: SendEmailDraftVariables) =>
      jsonFetch<SendEmailDraftResponse>(`/api/email/orgs/${orgId}/drafts/${draftId}/send`, {
        method: 'POST',
      }),
  })
}
