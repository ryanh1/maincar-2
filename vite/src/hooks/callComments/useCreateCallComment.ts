import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'

import { jsonFetch } from '@/lib/api'
import type { CallCommentDraftAnchor, CallCommentResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

interface CreateCallCommentInput {
  orgId: string
  callId: string
  bodyJson: JSONContent
  anchor: CallCommentDraftAnchor
}

/** Creates one timed root and refreshes its rail. */
export function useCreateCallComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, callId, bodyJson, anchor }: CreateCallCommentInput) =>
      jsonFetch<CallCommentResponse>(`/api/orgs/${orgId}/calls/${callId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          bodyJson,
          atMs: anchor.atMs,
          ...(anchor.kind === 'selection' ? {
            anchorEndMs: anchor.anchorEndMs,
            anchorQuote: anchor.anchorQuote,
            selectionStartChar: anchor.selectionStartChar,
            selectionEndChar: anchor.selectionEndChar,
            transcriptId: anchor.transcriptId,
          } : {}),
        }),
      }),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.calls.comments(input.orgId, input.callId) }),
  })
}
