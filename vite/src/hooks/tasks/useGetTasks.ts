import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetTasksParams, GetTasksResponse } from '@/lib/taskTypes'

function buildTasksQuery(params: GetTasksParams): string {
  const search = new URLSearchParams({ limit: '100' })
  if (params.isDone !== undefined) search.set('isDone', String(params.isDone))
  return `?${search.toString()}`
}

/** Reads a bounded list of tasks for the active organization. */
export function useGetTasks(orgId: string | null | undefined, params: GetTasksParams = {}) {
  return useQuery({
    queryKey: queryKeys.tasks.list(orgId ?? 'none', params),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetTasksResponse>(`/api/orgs/${orgId}/tasks${buildTasksQuery(params)}`),
  })
}
