import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ReportResponse } from '@/lib/reportTypes'

/** The stored config for one report. An id must be present before this fetches. */
export function useGetReport(orgId: string | null | undefined, reportId: string | null) {
  return useQuery({
    queryKey: queryKeys.reports.detail(orgId ?? 'none', reportId ?? 'none'),
    enabled: !!orgId && !!reportId,
    queryFn: () => jsonFetch<ReportResponse>(`/api/orgs/${orgId}/reports/${reportId}`),
  })
}
