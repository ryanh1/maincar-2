import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateOrgInput, CreateOrgResponse } from './types'

/**
 * Create an org. The caller becomes its first admin and the server makes it their
 * active org, so the cache is cleared exactly as a switch does.
 */
export function useCreateOrg() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateOrgInput) =>
      jsonFetch<CreateOrgResponse>('/api/team/orgs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
    },
  })
}
