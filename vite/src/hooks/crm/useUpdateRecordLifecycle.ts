import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { ObjectDef } from '@/lib/crmTypes'

export interface UpdateRecordLifecycleInput {
  orgId: string
  object: ObjectDef
  recordId: string
  isArchived: boolean
  confirmArchive?: boolean
}

/** Archives or restores a record without touching its field values or activity history. */
export function useUpdateRecordLifecycle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, object, recordId, isArchived, confirmArchive }: UpdateRecordLifecycleInput) => {
      if (object.storage === 'record') {
        return jsonFetch(`/api/orgs/${orgId}/records/${recordId}`, {
          method: 'PATCH',
          body: JSON.stringify({ isArchived, ...(confirmArchive ? { confirmArchive: true } : {}) }),
        })
      }

      const routes: Record<string, string> = { person: 'people', company: 'companies', deal: 'deals' }
      const route = routes[object.slug]
      if (!route) throw new Error(`${object.name} cannot be archived from the grid yet.`)
      return jsonFetch(`/api/orgs/${orgId}/${route}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived, ...(confirmArchive ? { confirmArchive: true } : {}) }),
      })
    },
    onSuccess: (_response, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.records.listAll(input.orgId, input.object.id) })
    },
  })
}
