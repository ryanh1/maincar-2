import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { InboundForwardingPatch, InboundForwardingResponse } from '@/lib/inboundForwardingTypes'

export function useUpdateInboundForwarding(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: InboundForwardingPatch) =>
      jsonFetch<InboundForwardingResponse>(`/api/orgs/${orgId}/settings/inbound`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.inboundForwarding(orgId), data),
  })
}
