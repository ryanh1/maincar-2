import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CalendarEventCreateInput } from '@/lib/calendarTypes'

export interface CreateCalendarEventVariables extends CalendarEventCreateInput { orgId: string }

/** Creates an event through the selected provider, then refreshes the calendar projection. */
export function useCreateCalendarEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateCalendarEventVariables) =>
      jsonFetch(`/api/calendar/orgs/${orgId}/events`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
