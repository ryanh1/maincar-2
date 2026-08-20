import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/authStore'
import type { UpdateProfileInput, UpdateProfileResponse } from './types'

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const setMe = useAuthStore((s) => s.setMe)

  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      jsonFetch<UpdateProfileResponse>('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      // The store is the source of truth for the signed-in user, so push the new
      // profile straight into it rather than waiting for a refetch.
      setMe({ user: data.user, org: data.org })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.all })
    },
  })
}
