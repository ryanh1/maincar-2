import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ReportConfig, ReportResponse } from '@/lib/reportTypes'

export interface CreateReportVariables {
  orgId: string
  name: string
  config: ReportConfig
}

/** Saves a named report, then refreshes the owner’s reports list. */
export function useCreateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, name, config }: CreateReportVariables) =>
      jsonFetch<ReportResponse>(`/api/orgs/${orgId}/reports`, {
        method: 'POST',
        body: JSON.stringify({ name, config }),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all(variables.orgId) }),
  })
}
