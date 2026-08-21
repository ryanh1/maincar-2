import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/authStore'
import type { UpdateOrgInput, UpdateOrgResponse } from './types'

/** Rename an org or set its logo. The server allows this for org admins only. */
export function useUpdateOrg() {
  const queryClient = useQueryClient()
  const org = useAuthStore((s) => s.org)
  const user = useAuthStore((s) => s.user)
  const memberships = useAuthStore((s) => s.memberships)
  const setMe = useAuthStore((s) => s.setMe)

  return useMutation({
    mutationFn: ({ orgId, ...body }: UpdateOrgInput) =>
      jsonFetch<UpdateOrgResponse>(`/api/team/orgs/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      // The renamed org is the one in the header and the switcher, so the store
      // gets the new copy immediately rather than waiting for a refetch.
      if (org?.id === data.org.id) {
        setMe({
          user,
          org: data.org,
          memberships: memberships.map((m) =>
            m.orgId === data.org.id ? { ...m, org: data.org } : m,
          ),
        })
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
    },
  })
}
