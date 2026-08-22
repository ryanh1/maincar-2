import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetNotificationsParams, GetNotificationsResponse } from '@/lib/notificationTypes'

function buildNotificationsQuery(params: GetNotificationsParams): string {
  const search = new URLSearchParams()
  if (params.view && params.view !== 'inbox') search.set('view', params.view)
  if (params.read && params.read !== 'all') search.set('read', params.read === 'read' ? 'true' : 'false')
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/** One server-paged view of a recipient's private notification inbox. */
export function useGetNotifications(
  orgId: string | null | undefined,
  params: GetNotificationsParams = {},
) {
  return useQuery({
    queryKey: queryKeys.notifications.list(orgId ?? 'none', params as Record<string, unknown>),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () => jsonFetch<GetNotificationsResponse>(`/api/orgs/${orgId}/notifications${buildNotificationsQuery(params)}`),
  })
}
