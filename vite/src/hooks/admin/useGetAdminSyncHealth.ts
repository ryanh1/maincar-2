import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { AdminSyncHealthResponse } from '@/lib/adminSyncHealthTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useGetAdminSyncHealth() {
  return useQuery({
    queryKey: queryKeys.admin.syncHealth,
    queryFn: () => jsonFetch<AdminSyncHealthResponse>('/api/admin/sync-health'),
    refetchInterval: 60_000,
  })
}
