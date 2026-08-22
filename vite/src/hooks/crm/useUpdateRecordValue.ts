import { useMutation } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { AttributeDef, ObjectDef } from '@/lib/crmTypes'

export interface UpdateRecordValueInput {
  orgId: string
  object: ObjectDef
  attribute: AttributeDef
  recordId: string
  value: unknown
}

/** Save one grid field through the established object write routes. */
export function useUpdateRecordValue() {
  return useMutation({
    mutationFn: ({ orgId, object, attribute, recordId, value }: UpdateRecordValueInput) => {
      if (object.storage === 'record') {
        return jsonFetch(`/api/orgs/${orgId}/records/${recordId}`, {
          method: 'PATCH',
          body: JSON.stringify({ values: { [attribute.slug]: value } }),
        })
      }

      const routes: Record<string, string> = { person: 'people', company: 'companies', deal: 'deals' }
      const route = routes[object.slug]
      if (!route) throw new Error(`${object.name} cannot be edited in the grid yet.`)
      const body =
        attribute.storage === 'custom'
          ? { customValues: { [attribute.slug]: value } }
          : { [attribute.slug]: attribute.type === 'date' && typeof value === 'string' ? `${value}T12:00:00.000Z` : value }
      return jsonFetch(`/api/orgs/${orgId}/${route}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
  })
}
