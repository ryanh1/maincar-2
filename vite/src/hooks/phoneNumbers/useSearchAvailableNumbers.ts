import { useMutation } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { SearchNumbersInput, SearchNumbersResponse } from '@/lib/phoneNumberTypes'

/**
 * What a search sends. `orgId` travels in the variables rather than as a hook
 * argument, the way every other mutation in the app does it, so the hook never
 * has to hold a possibly-null org between render and click.
 */
export interface SearchAvailableNumbersVariables extends SearchNumbersInput {
  orgId: string
}

/**
 * Search Twilio for numbers to buy.
 *
 * A mutation, not a query, even though it reads and writes nothing persistent:
 * the criteria are a body, the search is a live network call that spends the
 * org's Twilio quota, and the results are never cached — a number listed as for
 * sale can be taken by someone else at any moment, so there is nothing worth
 * holding under a query key. The caller reads the results off the mutation's
 * return value or `data`.
 *
 * Not retried automatically: each attempt is a fresh billable Twilio listing.
 */
export function useSearchAvailableNumbers() {
  return useMutation({
    retry: false,
    mutationFn: ({ orgId, ...body }: SearchAvailableNumbersVariables) =>
      jsonFetch<SearchNumbersResponse>(`/api/orgs/${orgId}/phone-numbers/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}
