import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetNumbersResponse } from '@/lib/phoneNumberTypes'

/**
 * The phone numbers an org owns, active first.
 *
 * Not paginated: the route returns every number the caller owns so the caller-ID
 * picker can show all of them at once, so there is one answer per org and the key
 * is the org alone. `activeCount` lets the UI SEE a broken pair (two active, or
 * zero) rather than pick one at random.
 */
export function useGetNumbers(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: queryKeys.phoneNumbers.list(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/orgs/null/phone-numbers and take a 404 before sign-in resolves the org.
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetNumbersResponse>(`/api/orgs/${orgId}/phone-numbers`),
  })
}
