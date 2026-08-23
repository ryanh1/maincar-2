import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CaptureSettingsResponse } from '@/lib/captureSettingsTypes'

export function useGetCaptureSettings(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.captureSettings(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<CaptureSettingsResponse>(`/api/orgs/${orgId}/settings/capture`),
  })
}
