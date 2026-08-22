import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteReportVariables {
  orgId: string
  reportId: string
}

/** Moves a report to its 30-day trash instead of permanently deleting it. */
export function useDeleteReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, reportId }: DeleteReportVariables) =>
      jsonFetch(`/api/orgs/${orgId}/reports/${reportId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all(variables.orgId) }),
  })
}
