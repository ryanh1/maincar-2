import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { AccountTimelineParams, AccountTimelineRoot, GetAccountTimelineDetailResponse } from '@/lib/accountTimelineTypes'

function buildDetailQuery(root: AccountTimelineRoot, params: AccountTimelineParams): string {
  const search = new URLSearchParams({ rootType: root.type, rootId: root.id })
  if (params.occurredFrom) search.set('occurredFrom', params.occurredFrom)
  if (params.occurredTo) search.set('occurredTo', params.occurredTo)
  if (params.sourceType) search.set('sourceType', params.sourceType)
  if (params.direction) search.set('direction', params.direction)
  if (params.personId) search.set('personId', params.personId)
  if (params.dealId) search.set('dealId', params.dealId)
  return search.toString()
}

/** Reads a selected timeline event through the scope-checked typed detail route. */
export function useGetAccountTimelineDetail(
  orgId: string | null | undefined,
  root: AccountTimelineRoot | null,
  eventId: string | null,
  params: AccountTimelineParams = {},
) {
  return useQuery({
    queryKey: queryKeys.accountTimeline.detail(
      orgId ?? 'none', root ?? { type: 'company', id: 'none' }, eventId ?? 'none', params as Record<string, unknown>,
    ),
    enabled: !!orgId && !!root && !!eventId,
    queryFn: () => jsonFetch<GetAccountTimelineDetailResponse>(
      `/api/orgs/${orgId}/account-timeline/${eventId}?${buildDetailQuery(root!, params)}`,
    ),
  })
}
