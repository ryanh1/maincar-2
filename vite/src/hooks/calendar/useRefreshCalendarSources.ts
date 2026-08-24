import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CalendarSyncResult } from '@/lib/calendarTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface RefreshCalendarSourcesVariables { orgId: string; sourceIds: string[] }

/** Refreshes each visible provider calendar, then reloads the synchronized projection. */
export function useRefreshCalendarSources() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, sourceIds }: RefreshCalendarSourcesVariables) => Promise.all(
      sourceIds.map((sourceId) => jsonFetch<{ sync: CalendarSyncResult }>(
        `/api/calendar/orgs/${orgId}/sources/${sourceId}/sync`,
        { method: 'POST' },
      ).then(({ sync }) => sync)),
    ),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
