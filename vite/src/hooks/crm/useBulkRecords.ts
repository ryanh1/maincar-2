import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { BulkExportResponse, BulkRecordsResponse, ObjectDef, RecordBulkAction, RecordBulkSelection } from '@/lib/crmTypes'

export interface BulkRecordsInput {
  orgId: string
  object: Pick<ObjectDef, 'id'>
  selection: RecordBulkSelection
  action: RecordBulkAction
}

/** Applies a server-side action to explicit rows or the active filtered view. */
export function useBulkRecords() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, object, selection, action }: BulkRecordsInput) =>
      jsonFetch<BulkRecordsResponse | BulkExportResponse>(`/api/orgs/${orgId}/objects/${object.id}/bulk`, {
        method: 'POST',
        body: JSON.stringify({ selection, action }),
      }),
    onSuccess: (_response, { orgId, object, action }) => {
      if (action.type === 'export') return
      void queryClient.invalidateQueries({ queryKey: queryKeys.records.listAll(orgId, object.id) })
      if (action.type === 'addToList') void queryClient.invalidateQueries({ queryKey: queryKeys.crm.listEntries(orgId, action.listId) })
    },
  })
}
