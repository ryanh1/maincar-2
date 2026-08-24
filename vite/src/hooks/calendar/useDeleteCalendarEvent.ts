import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteCalendarEventVariables { orgId: string; eventId: string; expectedVersion: string | null }

/** Deletes an event at its provider and refreshes the synchronized projection. */
export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, eventId, expectedVersion }: DeleteCalendarEventVariables) =>
      jsonFetch(`/api/calendar/orgs/${orgId}/events/${eventId}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion }) }),
    onSuccess: (_data, { orgId }) => queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(orgId) }),
  })
}
