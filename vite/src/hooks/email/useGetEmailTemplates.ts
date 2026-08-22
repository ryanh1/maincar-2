import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailTemplateListQuery, GetEmailTemplatesResponse } from '@/lib/emailTypes'

/**
 * The requested page of templates visible to the signed-in rep in this org.
 *
 * Visibility and list controls are server-enforced, so every parameter belongs
 * in both the URL and the cache key. The previous response remains as placeholder
 * data during a page/search/sort change, preventing the Settings table from
 * briefly rendering empty or stale-looking rows while its replacement loads.
 */
export function useGetEmailTemplates(
  orgId: string | null | undefined,
  query?: EmailTemplateListQuery,
) {
  return useQuery({
    // 'none' is a placeholder key that is never fetched — `enabled` is false
    // without an org, so nothing is ever written under it.
    queryKey: queryKeys.email.templates(orgId ?? 'none', query),
    // No org means no URL to build. Firing anyway would request
    // /api/email/orgs/null/templates and take a 404 on every render before
    // sign-in finishes resolving which org the rep is in.
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams()
      if (query?.scope) params.set('scope', query.scope)
      if (query?.page !== undefined) params.set('page', String(query.page))
      if (query?.limit !== undefined) params.set('limit', String(query.limit))
      if (query?.sort) params.set('sort', query.sort)
      if (query?.dir) params.set('dir', query.dir)
      if (query?.q !== undefined) params.set('q', query.q)

      const search = params.toString()
      const path = `/api/email/orgs/${orgId}/templates${search ? `?${search}` : ''}`
      return jsonFetch<GetEmailTemplatesResponse>(path)
    },
  })
}
