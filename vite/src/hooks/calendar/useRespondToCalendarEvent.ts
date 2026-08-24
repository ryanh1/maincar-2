import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CalendarAttendeeResponse, CalendarRecurrenceScope } from '@/lib/calendarTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface RespondToCalendarEventVariables {
  orgId: string
  eventId: string
  response: Exclude<CalendarAttendeeResponse, 'needs-action'>
  scope: CalendarRecurrenceScope
}

/** Sends the rep's invitation response to the provider and refreshes Calendar. */
export function useRespondToCalendarEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, eventId, ...body }: RespondToCalendarEventVariables) =>
      jsonFetch(`/api/calendar/orgs/${orgId}/events/${eventId}/rsvp`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
