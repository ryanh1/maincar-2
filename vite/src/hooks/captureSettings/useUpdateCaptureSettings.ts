import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CaptureSettings, CaptureSettingsResponse } from '@/lib/captureSettingsTypes'

export function useUpdateCaptureSettings(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: CaptureSettings) =>
      jsonFetch<CaptureSettingsResponse>(`/api/orgs/${orgId}/settings/capture`, {
        method: 'PATCH',
        body: JSON.stringify(settings),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.captureSettings(orgId), data)
    },
  })
}
