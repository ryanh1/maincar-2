import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface RenameReportVariables {
  orgId: string
  reportId: string
  name: string
}

/** Renames a report the current rep owns. */
export function useRenameReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, reportId, name }: RenameReportVariables) =>
      jsonFetch(`/api/orgs/${orgId}/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all(variables.orgId) }),
  })
}
