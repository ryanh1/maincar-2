import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetEmailTemplatesResponse } from '@/lib/emailTypes'

/**
 * Every template in this ORG, alphabetically.
 *
 * Not "this rep's templates" — there is no such thing. A template belongs to the
 * org and any member may read, edit, or delete any of them
 * (SPEC-composer-templates.md § 2), so this one cache entry is what the whole
 * team sees. `createdById` is attribution the list can show; a null means the
 * author has left, which is a fact about the template and not an error.
 *
 * Two screens read this: Settings → Email templates, and the card footer's
 * template dropdown. Both want the whole list, both want it in the same order,
 * so there is one query and no page to ask for — the route caps it at 200.
 */
export function useGetEmailTemplates(orgId: string | null | undefined) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: queryKeys.email.templates(orgId ?? 'none'),
    // No org means no URL to build. Firing anyway would request
    // /api/email/orgs/null/templates and take a 404 on every render before
    // sign-in finishes resolving which org the rep is in.
    enabled: !!orgId,
    queryFn: () => jsonFetch<GetEmailTemplatesResponse>(`/api/email/orgs/${orgId}/templates`),
  })
}
