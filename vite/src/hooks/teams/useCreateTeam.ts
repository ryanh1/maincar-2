import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateTeamInput, TeamResponse } from './types'

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateTeamInput) =>
      jsonFetch<TeamResponse>(`/api/orgs/${orgId}/teams`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all(variables.orgId) })
    },
  })
}
