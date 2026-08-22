import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ReportConfig, ReportResponse } from '@/lib/reportTypes'

export interface UpdateReportConfigVariables {
  orgId: string
  reportId: string
  config: ReportConfig
}

/** Persists a builder edit, including structured filters, then refreshes the report. */
export function useUpdateReportConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, reportId, config }: UpdateReportConfigVariables) =>
      jsonFetch<ReportResponse>(`/api/orgs/${orgId}/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ config }),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all(variables.orgId) }),
  })
}
