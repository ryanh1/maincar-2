import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CaptureSettingsResponse } from '@/lib/captureSettingsTypes'

export function useSetCaptureOptOut(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (optedOut: boolean) =>
      jsonFetch<{ optedOut: boolean }>(`/api/orgs/${orgId}/settings/capture/opt-out`, {
        method: 'PUT',
        body: JSON.stringify({ optedOut }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<CaptureSettingsResponse>(queryKeys.captureSettings(orgId), (current) =>
        current ? { ...current, optedOut: data.optedOut } : current,
      )
    },
  })
}
