import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { DispositionNextStepRulesResponse } from '@/lib/nextStepTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useGetDispositionNextStepRules(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nextSteps.rules(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<DispositionNextStepRulesResponse>(`/api/orgs/${orgId}/next-steps/rules`),
  })
}
