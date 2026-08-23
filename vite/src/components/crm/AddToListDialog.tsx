import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBulkRecords, useGetLists } from '@/hooks/crm'
import type { BulkRecordsResponse, ObjectDef, RecordBulkSelection } from '@/lib/crmTypes'

import { NewListDialog } from './NewListDialog'

interface AddToListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  object: Pick<ObjectDef, 'id' | 'slug' | 'name' | 'namePlural'>
  selection: RecordBulkSelection
  selectedCount: number
  onAdded: () => void
}

/** Adds an explicit or filter-backed selection to an existing or new compatible list. */
export function AddToListDialog({ open, onOpenChange, orgId, object, selection, selectedCount, onAdded }: AddToListDialogProps) {
  const bulkRecords = useBulkRecords()
  const listsQuery = useGetLists(orgId)
  const [listId, setListId] = useState('')
  const [newListOpen, setNewListOpen] = useState(false)
  const compatibleLists = useMemo(
    () => (listsQuery.data?.lists ?? []).filter((list) => !list.isArchived && list.objectSlug === object.slug),
    [listsQuery.data?.lists, object.slug],
  )

  function setOpen(nextOpen: boolean) {
    if (!nextOpen) setListId('')
    onOpenChange(nextOpen)
  }

  async function addToList(targetListId: string) {
    try {
      const response = await bulkRecords.mutateAsync({
        orgId,
        object,
        selection,
        action: { type: 'addToList', listId: targetListId },
      })
      const { affectedCount } = response as BulkRecordsResponse
      toast.success(`Added ${affectedCount} ${object.namePlural.toLowerCase()} to the list.`)
      onAdded()
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not add the records to the list. Try again.')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to list</DialogTitle>
            <DialogDescription>Add {selectedCount} selected {object.namePlural.toLowerCase()} to a list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="add-to-list-select" className="text-sm font-medium">List</label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger id="add-to-list-select" aria-label="List" className="w-full"><SelectValue placeholder="Choose a list" /></SelectTrigger>
              <SelectContent>
                {compatibleLists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}
                {!listsQuery.isPending && compatibleLists.length === 0 && <SelectItem value="none" disabled>No compatible lists</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setOpen(false); setNewListOpen(true) }} disabled={bulkRecords.isPending}>New list</Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={bulkRecords.isPending}>Cancel</Button>
            <Button onClick={() => void addToList(listId)} disabled={!listId || bulkRecords.isPending}>{bulkRecords.isPending ? 'Adding…' : 'Add to list'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewListDialog
        open={newListOpen}
        onOpenChange={setNewListOpen}
        orgId={orgId}
        object={object}
        onCreated={(list) => addToList(list.id)}
      />
    </>
  )
}
