import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetOrgsResponse } from './types'

/** Every org the signed-in user belongs to. Backs the org switcher. */
export function useGetOrgs() {
  return useQuery({
    queryKey: queryKeys.orgs.list(),
    queryFn: async () => {
      const data = await jsonFetch<GetOrgsResponse>('/api/team/orgs')
      return data.orgs
    },
  })
}
