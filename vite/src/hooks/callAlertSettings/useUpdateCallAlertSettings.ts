import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallAlertSettings } from '@/lib/callAlertSettings'

export function useUpdateCallAlertSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (callAlertSettings: CallAlertSettings) => jsonFetch<{ callAlertSettings: CallAlertSettings }>('/api/call-alert-settings', {
      method: 'PUT', body: JSON.stringify({ callAlertSettings }),
    }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.callAlertSettings, data),
  })
}
