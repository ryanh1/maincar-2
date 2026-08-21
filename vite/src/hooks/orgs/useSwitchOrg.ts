import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import type { SwitchOrgResponse } from './types'

/**
 * Make another org the active one.
 *
 * Everything cached below this point belongs to the org that was active when it
 * was fetched, so the whole cache is dropped on a switch. Invalidating key by key
 * would leave one stale list showing the previous org's rows, which is the exact
 * failure org isolation exists to prevent. This is the one other place besides
 * sign-out that clears the cache, and for the same reason.
 */
export function useSwitchOrg() {
  const queryClient = useQueryClient()
  const memberships = useAuthStore((s) => s.memberships)
  const setMe = useAuthStore((s) => s.setMe)

  return useMutation({
    mutationFn: (orgId: string) =>
      jsonFetch<SwitchOrgResponse>(`/api/team/orgs/${orgId}/switch`, { method: 'POST' }),
    onSuccess: (data) => {
      setMe({ user: data.user, org: data.org, memberships })
      queryClient.clear()
    },
  })
}
