import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { NotificationPreference } from '@/lib/notificationPreferences'
import type { NotificationPreferencesResponse } from './useGetNotificationPreferences'

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationPreferences: NotificationPreference[]) => jsonFetch<NotificationPreferencesResponse>('/api/notification-preferences', {
      method: 'PUT', body: JSON.stringify({ notificationPreferences }),
    }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.notificationPreferences, data),
  })
}
