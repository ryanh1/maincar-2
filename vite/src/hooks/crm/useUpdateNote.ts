import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface UpdateNoteInput {
  orgId: string
  noteId: string
  bodyJson: Record<string, unknown>
}

/** Updates one note, then refreshes its source-authoritative activity surfaces. */
export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, noteId, bodyJson }: UpdateNoteInput) =>
      jsonFetch(`/api/orgs/${orgId}/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ bodyJson }),
      }),
    onSuccess: (_data, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accountTimeline.all(variables.orgId) }),
    ]),
  })
}
