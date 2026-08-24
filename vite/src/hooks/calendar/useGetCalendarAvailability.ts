import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CalendarAvailabilityResponse } from '@/lib/calendarTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface GetCalendarAvailabilityParams { startsAt: string; endsAt: string }

/** Provider-backed busy windows for one connected calendar source. */
export function useGetCalendarAvailability(
  orgId: string | null | undefined,
  sourceId: string | null | undefined,
  params: GetCalendarAvailabilityParams | null,
) {
  const query: Record<string, string> = params ? { startsAt: params.startsAt, endsAt: params.endsAt } : {}
  const search = params ? new URLSearchParams([['startsAt', params.startsAt], ['endsAt', params.endsAt]]) : null
  return useQuery({
    queryKey: queryKeys.calendar.availability(orgId ?? 'none', sourceId ?? 'none', query),
    enabled: !!orgId && !!sourceId && !!params,
    queryFn: () => jsonFetch<CalendarAvailabilityResponse>(`/api/calendar/orgs/${orgId}/sources/${sourceId}/availability?${search}`),
  })
}
