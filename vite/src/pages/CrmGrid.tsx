import { Table2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/PageHeader'
import { ListEntryGrid } from '@/components/crm/ListEntryGrid'
import { AddListFieldDialog } from '@/components/crm/AddListFieldDialog'
import { ListEntryReorderDialog } from '@/components/crm/ListEntryReorderDialog'
import { RecordCount } from '@/components/crm/RecordCount'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetList, useGetListEntries, useGetObject, useGetObjects, useRemoveListEntry, useReorderListEntries, useUpdateListEntry, type ListEntrySort } from '@/hooks/crm'
import type { CrmListEntry } from '@/lib/crmTypes'
import { useAuth } from '@/providers/useAuth'

function entryName(entry: CrmListEntry): string | null {
  const value = entry.target?.name
  return typeof value === 'string' && value.trim() ? value : null
}

function ListGridRoute({ listId }: { listId: string }) {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const [sort, setSort] = useState<ListEntrySort>('position')
  const listQuery = useGetList(orgId, listId)
  const entriesQuery = useGetListEntries(orgId, listId, sort)
  const objectsQuery = useGetObjects(org?.id)
  const list = listQuery.data?.list ?? null
  const object = objectsQuery.data?.objects.find((candidate) => candidate.slug === list?.objectSlug) ?? null
  const objectQuery = useGetObject(orgId, object?.id ?? null)
  const entries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? []
  const total = entriesQuery.data?.pages.at(-1)?.total ?? 0
  const removeListEntry = useRemoveListEntry()
  const updateListEntry = useUpdateListEntry()
  const reorderListEntries = useReorderListEntries()
  const [entryToRemove, setEntryToRemove] = useState<CrmListEntry | null>(null)
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [reorderOpen, setReorderOpen] = useState(false)
  const isPending = listQuery.isPending || entriesQuery.isPending || objectsQuery.isPending || (object !== null && objectQuery.isPending)
  const isError = listQuery.isError || entriesQuery.isError || objectsQuery.isError || objectQuery.isError

  function retry() {
    void listQuery.refetch()
    void entriesQuery.refetch()
    void objectsQuery.refetch()
    if (object) void objectQuery.refetch()
  }

  async function confirmRemoval() {
    if (!orgId || !entryToRemove) return
    try {
      await removeListEntry.mutateAsync({ orgId, listId, entryId: entryToRemove.id })
      setEntryToRemove(null)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not remove this record from the list.')
    }
  }

  function updateEntry(entry: CrmListEntry, valuesJson: Record<string, unknown>) {
    if (!orgId) return
    void updateListEntry.mutateAsync({ orgId, listId, entryId: entry.id, valuesJson }).catch((error: unknown) => {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not save the list value. Try again.')
    })
  }

  async function saveOrder(entryIds: string[]) {
    if (!orgId) return
    try {
      await reorderListEntries.mutateAsync({ orgId, listId, entryIds })
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not save the list order. Try again.')
      throw error
    }
  }

  const name = entryToRemove ? entryName(entryToRemove) : null
  const canEditList = Boolean(list && objectQuery.data && orgId)
  const manuallyOrdered = sort === 'position'

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col">
      <PageHeader
        icon={Table2}
        title={list?.name ?? 'List'}
        count={isPending ? undefined : total}
        action={canEditList ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAddFieldOpen(true)}>Add list field</Button>
            <Button size="sm" variant="secondary" disabled={!manuallyOrdered || total === 0} onClick={() => setReorderOpen(true)}>Reorder</Button>
            <Select value={sort} onValueChange={(value) => setSort(value as ListEntrySort)}>
              <SelectTrigger aria-label="List sort" className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="position">Manual order</SelectItem>
                <SelectItem value="createdAt">Date added</SelectItem>
                <SelectItem value="updatedAt">Last updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : undefined}
      />
      {!manuallyOrdered && (
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <span className="text-xs text-text-muted">Clear sort to reorder by hand.</span>
          <Button size="sm" variant="secondary" onClick={() => setSort('position')}>Clear sort</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 pt-4">
        {isPending && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}
        {!isPending && isError && <div className="flex h-full flex-col items-center justify-center gap-3"><p className="text-sm text-destructive">Could not load this list.</p><Button variant="secondary" size="sm" onClick={retry}>Try again</Button></div>}
        {!isPending && !isError && !list && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">This list is unavailable.</div>}
        {!isPending && !isError && list && !object && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">This list’s object is unavailable.</div>}
        {!isPending && !isError && list && objectQuery.data && total === 0 && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No records are in this list.</div>}
        {!isPending && !isError && list && objectQuery.data && total > 0 && (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="self-end"><RecordCount filteredCount={total} isFiltered={false} totalCount={total} /></div>
            <div className="min-h-0 flex-1"><ListEntryGrid orgId={orgId!} object={object} attributes={objectQuery.data.object.attributes} entries={entries} totalCount={total} hasNextPage={entriesQuery.hasNextPage ?? false} isFetchingNextPage={entriesQuery.isFetchingNextPage} fetchNextPage={entriesQuery.fetchNextPage} onRemoveEntry={setEntryToRemove} onUpdateEntry={updateEntry} /></div>
          </div>
        )}
      </div>
      {canEditList && <AddListFieldDialog open={addFieldOpen} onOpenChange={setAddFieldOpen} orgId={orgId!} objectId={object!.id} />}
      {canEditList && reorderOpen && <ListEntryReorderDialog open onOpenChange={setReorderOpen} entries={entries} onSave={saveOrder} />}
      <AlertDialog open={entryToRemove !== null} onOpenChange={(open) => { if (!open && !removeListEntry.isPending) setEntryToRemove(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{name ? `Remove ${name} from this list?` : 'Remove this record from the list?'}</AlertDialogTitle><AlertDialogDescription>{name ? `${name}’s record will stay unchanged.` : 'The record will stay unchanged.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel size="sm" disabled={removeListEntry.isPending}>Cancel</AlertDialogCancel><AlertDialogAction size="sm" variant="destructive" disabled={removeListEntry.isPending} onClick={(event) => { event.preventDefault(); void confirmRemoval() }}>{removeListEntry.isPending ? 'Removing…' : 'Remove from list'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
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
