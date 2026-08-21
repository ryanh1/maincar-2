import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetOrgNumbersResponse } from '@/lib/phoneNumberTypes'

/**
 * Every phone number the organization owns, with its holder — the admin-only
 * inventory MAI-197 adds. `useGetNumbers` answers "which numbers are mine";
 * this answers "which numbers is the org paying for, and who has them".
 *
 * The server 403s a non-admin, so this hook is only ever mounted behind an
 * `isAdmin` check — it never fires the request just to find out.
 */
export function useGetOrgNumbers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.phoneNumbers.orgList(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetOrgNumbersResponse>(`/api/orgs/${orgId}/phone-numbers/all`),
  })
}
