import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallAlertSettings } from '@/lib/callAlertSettings'

export function useGetCallAlertSettings() {
  return useQuery({
    queryKey: queryKeys.callAlertSettings,
    queryFn: () => jsonFetch<{ callAlertSettings: CallAlertSettings }>('/api/call-alert-settings'),
  })
}
