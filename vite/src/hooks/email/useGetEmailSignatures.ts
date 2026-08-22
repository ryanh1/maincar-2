import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { GetEmailSignaturesResponse } from '@/lib/emailTypes'
import { queryKeys } from '@/lib/queryKeys'

/** The signed-in rep's signatures, default first, for Settings and the composer. */
export function useGetEmailSignatures(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.email.signatures(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetEmailSignaturesResponse>(`/api/email/orgs/${orgId}/signatures`),
  })
}
