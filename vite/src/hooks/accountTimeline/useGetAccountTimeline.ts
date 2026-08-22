import { useInfiniteQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type {
  AccountTimelineParams,
  AccountTimelineRoot,
  GetAccountTimelineResponse,
} from '@/lib/accountTimelineTypes'

export type { AccountTimelineParams, AccountTimelineRoot } from '@/lib/accountTimelineTypes'

export type AccountTimelineQueryState = 'loading' | 'error' | 'empty' | 'ready'

function buildTimelineQuery(root: AccountTimelineRoot, params: AccountTimelineParams, cursor: string | null): string {
  const search = new URLSearchParams({ rootType: root.type, rootId: root.id })
  if (params.occurredFrom) search.set('occurredFrom', params.occurredFrom)
  if (params.occurredTo) search.set('occurredTo', params.occurredTo)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sourceType) search.set('sourceType', params.sourceType)
  if (params.direction) search.set('direction', params.direction)
  if (params.personId) search.set('personId', params.personId)
  if (params.dealId) search.set('dealId', params.dealId)
  if (cursor) search.set('cursor', cursor)
  return search.toString()
}

/**
 * Reads one account timeline through the server's cursor API. The root and
 * filters are part of the key, so changing either starts a fresh event page.
 */
export function useGetAccountTimeline(
  orgId: string | null | undefined,
  root: AccountTimelineRoot | null,
  params: AccountTimelineParams = {},
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.accountTimeline.list(
      orgId ?? 'none',
      root ?? { type: 'company', id: 'none' },
      params as Record<string, unknown>,
    ),
    enabled: !!orgId && !!root,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      jsonFetch<GetAccountTimelineResponse>(
        `/api/orgs/${orgId}/account-timeline?${buildTimelineQuery(root!, params, pageParam)}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const events = query.data?.pages.flatMap((page) => page.events) ?? []
  const state: AccountTimelineQueryState = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : events.length === 0
        ? 'empty'
        : 'ready'

  return { ...query, events, state }
}
