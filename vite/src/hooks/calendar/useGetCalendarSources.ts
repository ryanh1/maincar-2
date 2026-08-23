import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CalendarSourcesResponse } from '@/lib/calendarTypes'

/** The rep's connected Calendar sources and their visible-calendar choices. */
export function useGetCalendarSources(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.calendar.sources(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<CalendarSourcesResponse>(`/api/calendar/orgs/${orgId}/sources`),
  })
}
