import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface DetailLayoutField {
  slug: string
  width: 1 | 2
}

export interface DetailLayoutSection {
  name: string
  fields: DetailLayoutField[]
  order: number
}

export interface DetailLayout {
  id?: string
  objectId: string
  sections: DetailLayoutSection[]
  railObjects: string[]
  feedKinds: string[]
  isDefault: boolean
}

interface GetDetailLayoutResponse {
  layout: DetailLayout
}

export interface SaveDetailLayoutInput {
  orgId: string
  objectId: string
  sections: DetailLayoutSection[]
  railObjects?: string[]
  feedKinds?: string[]
}

/** Reads the shared, per-object record layout. */
export function useGetDetailLayout(orgId: string | null | undefined, objectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.detailLayouts.detail(orgId ?? 'none', objectId ?? 'none'),
    enabled: !!orgId && !!objectId,
    queryFn: () => jsonFetch<GetDetailLayoutResponse>(`/api/orgs/${orgId}/detail-layouts/${objectId}`),
  })
}

/** Saves one shared object layout and replaces its cached version. */
export function useSaveDetailLayout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, objectId, sections, railObjects = [], feedKinds = [] }: SaveDetailLayoutInput) =>
      jsonFetch<GetDetailLayoutResponse>(`/api/orgs/${orgId}/detail-layouts/${objectId}`, {
        method: 'PUT',
        body: JSON.stringify({ sections, railObjects, feedKinds }),
      }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(queryKeys.detailLayouts.detail(variables.orgId, variables.objectId), data)
    },
  })
}
