import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/providers/authTypes'

export function useUpdateAvatar() {
  const queryClient = useQueryClient()
  const setMe = useAuthStore((s) => s.setMe)
  const org = useAuthStore((s) => s.org)
  const memberships = useAuthStore((s) => s.memberships)

  return useMutation({
    mutationFn: async (blob: Blob | null) => {
      let objectKey: string | null = null
      if (blob) {
        const target = await jsonFetch<{ uploadUrl: string; objectKey: string }>('/api/team/profile/avatar/upload-url', {
          method: 'POST',
          body: JSON.stringify({ contentType: blob.type, size: blob.size }),
        })
        const put = await fetch(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': blob.type },
          body: blob,
        })
        if (!put.ok) throw new Error('Could not upload the photo. Try again.')
        objectKey = target.objectKey
      }
      return jsonFetch<{ user: User }>('/api/team/profile/avatar', {
        method: 'PATCH',
        body: JSON.stringify({ objectKey }),
      })
    },
    onSuccess: ({ user }) => {
      setMe({ user, org, memberships })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.all })
    },
  })
}
