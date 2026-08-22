import { Table2 } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { PageHeader } from '@/components/PageHeader'
import { ListEntryGrid } from '@/components/crm/ListEntryGrid'
import { RecordCount } from '@/components/crm/RecordCount'
import { Button } from '@/components/ui/button'
import { useGetList, useGetListEntries, useGetObject, useGetObjects } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'

function ListGridRoute({ listId }: { listId: string }) {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const listQuery = useGetList(orgId, listId)
  const entriesQuery = useGetListEntries(orgId, listId)
  const objectsQuery = useGetObjects(org?.id)
  const list = listQuery.data?.list ?? null
  const object = objectsQuery.data?.objects.find((candidate) => candidate.slug === list?.objectSlug) ?? null
  const objectQuery = useGetObject(orgId, object?.id ?? null)
  const entries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? []
  const total = entriesQuery.data?.pages.at(-1)?.total ?? 0
  const isPending = listQuery.isPending || entriesQuery.isPending || objectsQuery.isPending || (object !== null && objectQuery.isPending)
  const isError = listQuery.isError || entriesQuery.isError || objectsQuery.isError || objectQuery.isError

  function retry() {
    void listQuery.refetch()
    void entriesQuery.refetch()
    void objectsQuery.refetch()
    if (object) void objectQuery.refetch()
  }

  return <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col"><PageHeader icon={Table2} title={list?.name ?? 'List'} count={isPending ? undefined : total} /><div className="min-h-0 flex-1 pt-4">{isPending && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}{!isPending && isError && <div className="flex h-full flex-col items-center justify-center gap-3"><p className="text-sm text-destructive">Could not load this list.</p><Button variant="secondary" size="sm" onClick={retry}>Try again</Button></div>}{!isPending && !isError && !list && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">This list is unavailable.</div>}{!isPending && !isError && list && !object && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">This list’s object is unavailable.</div>}{!isPending && !isError && list && objectQuery.data && total === 0 && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No records are in this list.</div>}{!isPending && !isError && list && objectQuery.data && total > 0 && <div className="flex h-full min-h-0 flex-col gap-2"><div className="self-end"><RecordCount filteredCount={total} isFiltered={false} totalCount={total} /></div><div className="min-h-0 flex-1"><ListEntryGrid attributes={objectQuery.data.object.attributes} entries={entries} totalCount={total} hasNextPage={entriesQuery.hasNextPage ?? false} isFetchingNextPage={entriesQuery.isFetchingNextPage} fetchNextPage={entriesQuery.fetchNextPage} /></div></div>}</div></div>
}

/** The legacy object placeholder plus MAI-285's live saved-list route. */
export function CrmGrid() {
  const { objectSlug, listId } = useParams<{ objectSlug?: string; listId?: string }>()
  const { org } = useAuth()
  const objectsQuery = useGetObjects(org?.id)
  if (listId) return <ListGridRoute listId={listId} />
  const object = objectsQuery.data?.objects.find((candidate) => candidate.slug === objectSlug)
  const title = object?.namePlural ?? 'Records'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-muted px-4">
        <h1 className="text-base font-semibold">{title}</h1>
        <div className="ml-auto">
          <RecordCount filteredCount={0} isFiltered={false} totalCount={0} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
        <div role="grid" aria-label={`${title} grid`} className="min-h-full border border-border bg-background">
          <div role="row" className="flex h-8 items-center border-b border-border bg-muted px-3">
            <div role="columnheader" className="text-xs font-medium text-muted-foreground">{title}</div>
          </div>
          <div role="row" className="flex min-h-24 items-center px-3">
            <div role="gridcell" className="text-sm text-muted-foreground">No records are in this object.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
