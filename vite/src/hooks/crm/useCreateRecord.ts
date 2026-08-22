import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ListRecordsResponse, ObjectDef, RecordRow } from '@/lib/crmTypes'

export interface CreateRecordInput {
  orgId: string
  object: ObjectDef
  values: Record<string, unknown>
}

function createdRow(response: unknown, object: ObjectDef): RecordRow | null {
  if (!response || typeof response !== 'object') return null
  const keyed = response as Record<string, unknown>
  const value = object.storage === 'record' ? keyed.record : keyed[object.slug]
  return value && typeof value === 'object' && 'id' in value ? value as RecordRow : null
}

/** Creates a record, then places the server-confirmed row into every open grid window. */
export function useCreateRecord() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, object, values }: CreateRecordInput) => {
      if (object.storage === 'record') {
        return jsonFetch(`/api/orgs/${orgId}/records`, {
          method: 'POST',
          body: JSON.stringify({ objectId: object.id, values }),
        })
      }

      const routeBySlug: Record<string, string> = { person: 'people', company: 'companies' }
      const route = routeBySlug[object.slug]
      if (!route) throw new Error(`${object.name} cannot be created from the grid.`)
      return jsonFetch(`/api/orgs/${orgId}/${route}`, {
        method: 'POST',
        body: JSON.stringify(values),
      })
    },
    onSuccess: (response, input) => {
      const row = createdRow(response, input.object)
      if (!row) return

      queryClient.setQueriesData<InfiniteData<ListRecordsResponse>>(
        { queryKey: queryKeys.records.listAll(input.orgId, input.object.id) },
        (current) => {
          if (!current || current.pages.some((page) => page.rows.some((candidate) => candidate.id === row.id))) return current
          return {
            ...current,
            pages: current.pages.map((page, index) => ({
              ...page,
              totalCount: page.totalCount + 1,
              ...(index === 0 ? { rows: [row, ...page.rows] } : {}),
            })),
          }
        },
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.records.listAll(input.orgId, input.object.id) })
    },
  })
}
