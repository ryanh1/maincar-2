import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CallComment, GetCallCommentsResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

interface ToggleReactionInput {
  orgId: string
  callId: string
  commentId: string
  userId: string
  emoji: string
  active: boolean
}

function updateComment(comment: CallComment, input: ToggleReactionInput): CallComment {
  if (comment.id !== input.commentId) return comment
  const withoutMine = comment.reactions.filter(
    (reaction) => reaction.userId !== input.userId || reaction.emoji !== input.emoji,
  )
  return {
    ...comment,
    reactions: input.active ? withoutMine : [...withoutMine, { userId: input.userId, emoji: input.emoji }],
  }
}

/** Applies reaction feedback immediately and restores the exact cache on failure. */
export function useToggleCallCommentReaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ToggleReactionInput) =>
      jsonFetch<void>(
        `/api/orgs/${input.orgId}/calls/${input.callId}/comments/${input.commentId}/reactions/${encodeURIComponent(input.emoji)}`,
        { method: input.active ? 'DELETE' : 'PUT' },
      ),
    onMutate: async (input) => {
      const key = queryKeys.calls.comments(input.orgId, input.callId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GetCallCommentsResponse>(key)
      queryClient.setQueryData<GetCallCommentsResponse>(key, (current) => current ? {
        ...current,
        comments: current.comments.map((thread) => ({
          ...updateComment(thread, input),
          replies: thread.replies.map((reply) => updateComment(reply, input)),
        })),
      } : current)
      return { key, previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
    },
    onSettled: (_data, _error, input) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.calls.comments(input.orgId, input.callId) }),
  })
}
