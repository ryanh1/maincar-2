import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CalendarEventPatch } from '@/lib/calendarTypes'

export interface UpdateCalendarEventVariables { orgId: string; eventId: string; expectedVersion: string | null; patch: CalendarEventPatch }

/** Updates one provider event conditionally, preserving conflict feedback from the API. */
export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, eventId, ...body }: UpdateCalendarEventVariables) =>
      jsonFetch(`/api/calendar/orgs/${orgId}/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
