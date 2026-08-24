import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CalendarEventsResponse } from '@/lib/calendarTypes'

export interface GetCalendarEventsParams {
  startsAt: string
  endsAt: string
}

/** Events overlapping the visible range. The API applies the user's source selection. */
export function useGetCalendarEvents(orgId: string | null | undefined, params: GetCalendarEventsParams, enabled = true) {
  const search = new URLSearchParams({ startsAt: params.startsAt, endsAt: params.endsAt })
  return useQuery({
    queryKey: queryKeys.calendar.events(orgId ?? 'none', { ...params }),
    enabled: !!orgId && enabled,
    queryFn: () => jsonFetch<CalendarEventsResponse>(`/api/calendar/orgs/${orgId}/events?${search}`),
  })
}
