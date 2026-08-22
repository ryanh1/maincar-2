import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/authStore'
import type { Org } from '@/providers/authTypes'

export function useUpdateOrgAvatar() {
  const queryClient = useQueryClient()
  const setMe = useAuthStore((s) => s.setMe)
  const user = useAuthStore((s) => s.user)
  const memberships = useAuthStore((s) => s.memberships)

  return useMutation({
    mutationFn: async ({ orgId, blob }: { orgId: string; blob: Blob | null }) => {
      let objectKey: string | null = null
      if (blob) {
        const target = await jsonFetch<{ uploadUrl: string; objectKey: string }>(
          `/api/team/orgs/${orgId}/avatar/upload-url`,
          {
            method: 'POST',
            body: JSON.stringify({ contentType: blob.type, size: blob.size }),
          },
        )
        const put = await fetch(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': blob.type },
          body: blob,
        })
        if (!put.ok) throw new Error('Could not upload the photo. Try again.')
        objectKey = target.objectKey
      }
      return jsonFetch<{ org: Org }>(`/api/team/orgs/${orgId}/avatar`, {
        method: 'PATCH',
        body: JSON.stringify({ objectKey }),
      })
    },
    onSuccess: ({ org }) => {
      setMe({
        user,
        org,
        memberships: memberships.map((membership) =>
          membership.orgId === org.id ? { ...membership, org } : membership,
        ),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
    },
  })
}
