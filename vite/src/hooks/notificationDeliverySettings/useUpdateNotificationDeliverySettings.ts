import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { NotificationDeliverySettings } from '@/lib/notificationDeliverySettings'
import type { NotificationDeliverySettingsResponse } from './useGetNotificationDeliverySettings'

export function useUpdateNotificationDeliverySettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationDeliverySettings: NotificationDeliverySettings) => jsonFetch<NotificationDeliverySettingsResponse>('/api/notification-delivery-settings', {
      method: 'PUT', body: JSON.stringify({ notificationDeliverySettings }),
    }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.notificationDeliverySettings, data),
  })
}
