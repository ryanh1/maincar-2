import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

interface DeleteCallCommentInput {
  orgId: string
  callId: string
  commentId: string
}

/** Deletes a leaf or lets the server preserve a root tombstone. */
export function useDeleteCallComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, callId, commentId }: DeleteCallCommentInput) =>
      jsonFetch<void>(`/api/orgs/${orgId}/calls/${callId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.calls.comments(input.orgId, input.callId) }),
  })
}
