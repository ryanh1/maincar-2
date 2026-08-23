import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetFieldChangesResponse } from '@/lib/crmTypes'

/** Bounded recent field changes for the grid's non-destructive highlight overlay. */
export function useGetFieldChanges(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
  days: number,
  active = true,
) {
  return useQuery({
    queryKey: queryKeys.records.fieldChanges(orgId ?? 'none', objectId ?? 'none', days),
    enabled: active && !!orgId && !!objectId,
    queryFn: () => jsonFetch<GetFieldChangesResponse>(`/api/orgs/${orgId}/objects/${objectId}/field-changes?days=${days}`),
  })
}
