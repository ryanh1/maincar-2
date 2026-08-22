import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { TeamResponse, UpdateTeamInput } from './types'

export function useUpdateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, teamId, ...body }: UpdateTeamInput) =>
      jsonFetch<TeamResponse>(`/api/orgs/${orgId}/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all(variables.orgId) })
    },
  })
}
