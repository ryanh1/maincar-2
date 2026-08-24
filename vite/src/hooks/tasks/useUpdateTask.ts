import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { UpdateTaskInput, UpdateTaskResponse } from '@/lib/taskTypes'

export type UpdateTaskVariables = {
  orgId: string
  taskId: string
  update: UpdateTaskInput
}

/** Updates one task and refreshes every task list in its organization. */
export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, taskId, update }: UpdateTaskVariables) =>
      jsonFetch<UpdateTaskResponse>(`/api/orgs/${orgId}/tasks/${taskId}`, {
        method: 'PATCH', body: JSON.stringify(update),
      }),
    onSuccess: (_data, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(variables.orgId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accountTimeline.all(variables.orgId) }),
    ]),
  })
}
