import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'

import { jsonFetch } from '@/lib/api'
import type { CallCommentResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

interface UpdateCallCommentInput {
  orgId: string
  callId: string
  commentId: string
  bodyJson: JSONContent
}

/** Replaces the author's structured body and refreshes the thread. */
export function useUpdateCallComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, callId, commentId, bodyJson }: UpdateCallCommentInput) =>
      jsonFetch<CallCommentResponse>(`/api/orgs/${orgId}/calls/${callId}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ bodyJson }),
      }),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.calls.comments(input.orgId, input.callId) }),
  })
}
