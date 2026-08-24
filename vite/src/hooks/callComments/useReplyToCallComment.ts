import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'

import { jsonFetch } from '@/lib/api'
import type { CallCommentResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

interface ReplyToCallCommentInput {
  orgId: string
  callId: string
  commentId: string
  bodyJson: JSONContent
}

/** Adds one reply below a timed root. */
export function useReplyToCallComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, callId, commentId, bodyJson }: ReplyToCallCommentInput) =>
      jsonFetch<CallCommentResponse>(`/api/orgs/${orgId}/calls/${callId}/comments/${commentId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ bodyJson }),
      }),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.calls.comments(input.orgId, input.callId) }),
  })
}
