import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CalendarSource } from '@/lib/calendarTypes'

export interface UpdateCalendarSourceVariables {
  orgId: string
  sourceId: string
  isSelected: boolean
}

/** Changes a secondary calendar's visibility, then refreshes the affected range. */
export function useUpdateCalendarSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, sourceId, isSelected }: UpdateCalendarSourceVariables) =>
      jsonFetch<{ source: CalendarSource }>(`/api/calendar/orgs/${orgId}/sources/${sourceId}`, {
        method: 'PATCH', body: JSON.stringify({ isSelected }),
      }),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
