import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { GetAttributeImpactResponse } from '@/lib/crmTypes'
import { queryKeys } from '@/lib/queryKeys'

/** Counts records with values before a custom field is deleted. */
export function useGetAttributeImpact(
  orgId: string | null | undefined,
  attributeId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.attributeImpact(orgId ?? 'none', attributeId ?? 'none'),
    enabled: !!orgId && !!attributeId,
    queryFn: () =>
      jsonFetch<GetAttributeImpactResponse>(`/api/orgs/${orgId}/attributes/${attributeId}/impact`),
  })
}
