import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { NotificationPreference } from '@/lib/notificationPreferences'

export interface NotificationPreferencesResponse {
  notificationPreferences: NotificationPreference[]
}

export function useGetNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: () => jsonFetch<NotificationPreferencesResponse>('/api/notification-preferences'),
  })
}
