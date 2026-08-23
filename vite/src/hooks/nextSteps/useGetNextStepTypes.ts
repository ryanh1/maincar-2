import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { NextStepTypesResponse } from '@/lib/nextStepTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useGetNextStepTypes(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nextSteps.types(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<NextStepTypesResponse>(`/api/orgs/${orgId}/next-steps/types`),
  })
}
