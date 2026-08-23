import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { NotificationDeliverySettings } from '@/lib/notificationDeliverySettings'

export interface NotificationDeliverySettingsResponse {
  notificationDeliverySettings: NotificationDeliverySettings
}

export function useGetNotificationDeliverySettings() {
  return useQuery({
    queryKey: queryKeys.notificationDeliverySettings,
    queryFn: () => jsonFetch<NotificationDeliverySettingsResponse>('/api/notification-delivery-settings'),
  })
}
