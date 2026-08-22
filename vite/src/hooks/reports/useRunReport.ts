import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ReportConfig, RunReportResponse } from '@/lib/reportTypes'

/** Runs a saved report’s server-validated config through the reporting engine. */
export function useRunReport(
  orgId: string | null | undefined,
  reportId: string | null,
  config: ReportConfig | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.reports.run(orgId ?? 'none', reportId ?? 'none'),
    enabled: !!orgId && !!reportId && !!config,
    queryFn: () =>
      jsonFetch<RunReportResponse>(`/api/orgs/${orgId}/reports/run`, {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),
  })
}
