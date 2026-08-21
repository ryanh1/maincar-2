import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetEmailDraftsResponse } from '@/lib/emailTypes'

/**
 * Every draft this rep has in this org, oldest first.
 *
 * Closed drafts come back too. `isOpen: false` means the card was dismissed but
 * the draft was KEPT, and the dock's "3 drafts" button is the only way back to
 * one — filtering them out here would hide finished work the rep can still send.
 *
 * There is no second page to ask for: the route caps the list at 200 and the
 * dock reads all of it in one request.
 */
export function useGetEmailDrafts(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: queryKeys.email.drafts(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/email/orgs/null/drafts and take a 404 on every render before sign-in
    // finishes resolving which org the rep is in.
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetEmailDraftsResponse>(`/api/email/orgs/${orgId}/drafts`),
  })
}
