import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface CreateNoteInput {
  orgId: string
  bodyJson: Record<string, unknown>
  links: Array<{ object: string; id: string }>
}

/** Saves one structured note, then refreshes every activity view in its org. */
export function useCreateNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, bodyJson, links }: CreateNoteInput) =>
      jsonFetch(`/api/orgs/${orgId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ bodyJson, links }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all }),
  })
}
