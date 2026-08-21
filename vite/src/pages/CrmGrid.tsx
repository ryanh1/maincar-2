import { useParams } from 'react-router-dom'

import { useGetLists, useGetObjects } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'

/**
 * The route-owned grid surface. The grid data plane lands in its own slice, but
 * this stable surface lets the rail switch context now without a dead link.
 */
export function CrmGrid() {
  const { objectSlug, listId } = useParams<{ objectSlug?: string; listId?: string }>()
  const { org } = useAuth()
  const objectsQuery = useGetObjects(org?.id)
  const listsQuery = useGetLists(org?.id)

  const object = objectsQuery.data?.objects.find((candidate) => candidate.slug === objectSlug)
  const list = listsQuery.data?.lists.find((candidate) => candidate.id === listId)
  const title = object?.namePlural ?? list?.name ?? 'Records'
  const emptyMessage = list ? 'No records are in this list.' : 'No records are in this object.'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-muted px-4">
        <h1 className="text-base font-semibold">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
        <div role="grid" aria-label={`${title} grid`} className="min-h-full border border-border bg-background">
          <div role="row" className="flex h-8 items-center border-b border-border bg-muted px-3">
            <div role="columnheader" className="text-xs font-medium text-muted-foreground">{title}</div>
          </div>
          <div role="row" className="flex min-h-24 items-center px-3">
            <div role="gridcell" className="text-sm text-muted-foreground">{emptyMessage}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
