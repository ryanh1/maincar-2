import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetNumbersResponse, GetPhoneNumbersParams } from '@/lib/phoneNumberTypes'

import { buildPhoneNumbersListQuery } from './listQuery'

/**
 * The phone numbers an org owns, active first.
 *
 * Without params, this is the caller-ID picker's complete list. Settings passes
 * table params to page, search, and sort on the server; those params become part
 * of the query key so page two never reuses page one's answer.
 */
export function useGetNumbers(orgId: string | null | undefined, params?: GetPhoneNumbersParams) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: params
      ? queryKeys.phoneNumbers.listPage(orgId ?? 'none', params as Record<string, unknown>)
      : queryKeys.phoneNumbers.list(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/orgs/null/phone-numbers and take a 404 before sign-in resolves the org.
    enabled: !!orgId,
    placeholderData: params ? keepPreviousData : undefined,
    queryFn: () =>
      jsonFetch<GetNumbersResponse>(
        `/api/orgs/${orgId}/phone-numbers${params ? buildPhoneNumbersListQuery(params) : ''}`,
      ),
  })
}
