import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { DispositionsResponse } from '@/lib/dispositionTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useGetDispositions(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.dispositions(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<DispositionsResponse>(`/api/orgs/${orgId}/dispositions`),
  })
}
