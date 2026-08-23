import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { ColorRulesResponse } from './types'

/** Lists every conditional-formatting rule in one view, ordered. */
export function useGetColorRules(orgId: string | null, viewId: string | null) {
  return useQuery({
    queryKey: queryKeys.colorRules.list(orgId ?? '', viewId ?? ''),
    queryFn: () => jsonFetch<ColorRulesResponse>(`/api/orgs/${orgId}/color-rules?viewId=${viewId}`),
    enabled: Boolean(orgId && viewId),
  })
}
