import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { InboundForwardingResponse } from '@/lib/inboundForwardingTypes'

export function useGetInboundForwarding(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.inboundForwarding(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<InboundForwardingResponse>(`/api/orgs/${orgId}/settings/inbound`),
  })
}
