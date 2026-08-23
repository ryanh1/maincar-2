import { useMemo, useState } from 'react'
import { Download, ListPlus, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBulkRecords, useGetLists } from '@/hooks/crm'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import type { AttributeDef, BulkExportResponse, ObjectDef, RecordBulkSelection, RecordRow } from '@/lib/crmTypes'

interface BulkActionBarProps {
  orgId: string
  object: ObjectDef
  attributes: AttributeDef[]
  selection: RecordBulkSelection
  selectedCount: number
  canChangeOwner: boolean
  onClear: () => void
}

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadCsv(rows: RecordRow[], attributes: AttributeDef[], fileName: string) {
  const columns = attributes.filter((attribute) => !attribute.isArchived && attribute.storage !== 'list')
  const csv = [columns.map((attribute) => csvValue(attribute.name)), ...rows.map((row) => columns.map((attribute) => csvValue(row[attribute.slug])))]
    .map((line) => line.join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName}-export.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The compact action surface for a server-side row selection. */
export function BulkActionBar({ orgId, object, attributes, selection, selectedCount, canChangeOwner, onClear }: BulkActionBarProps) {
  const bulk = useBulkRecords()
  const listsQuery = useGetLists(orgId)
  const membersQuery = useGetMembers(orgId, { limit: 200, sort: 'name' })
  const [dialog, setDialog] = useState<'list' | 'owner' | 'delete' | null>(null)
  const [listId, setListId] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const compatibleLists = useMemo(() => (listsQuery.data?.lists ?? []).filter((list) => !list.isArchived && list.objectSlug === object.slug), [listsQuery.data?.lists, object.slug])

  const run = async (action: Parameters<typeof bulk.mutateAsync>[0]['action']) => {
    try {
      const response = await bulk.mutateAsync({ orgId, object, selection, action })
      if (action.type === 'export') {
        const exportResponse = response as BulkExportResponse
        downloadCsv(exportResponse.rows, attributes, object.slug)
        toast.success(`Exported ${exportResponse.totalCount} ${object.namePlural.toLowerCase()}.`)
      } else {
        const { affectedCount } = response as { affectedCount: number }
        toast.success(action.type === 'delete' ? `Deleted ${affectedCount} ${object.namePlural.toLowerCase()}.` : `Updated ${affectedCount} ${object.namePlural.toLowerCase()}.`)
        onClear()
      }
      setDialog(null)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not complete the bulk action.')
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2" aria-label="Bulk actions">
        <span className="mr-1 text-sm font-medium">{selectedCount} selected</span>
        <Button size="sm" variant="secondary" onClick={() => setDialog('list')}><ListPlus />Add to list</Button>
        {canChangeOwner && <Button size="sm" variant="secondary" onClick={() => setDialog('owner')}><UserRound />Change owner</Button>}
        <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => void run({ type: 'export' })}><Download />Export</Button>
        <Button size="sm" variant="destructive" onClick={() => setDialog('delete')}><Trash2 />Delete</Button>
        <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
      </div>

      <Dialog open={dialog === 'list'} onOpenChange={(open) => { if (!open && !bulk.isPending) setDialog(null) }}>
        <DialogContent><DialogHeader><DialogTitle>Add to list</DialogTitle><DialogDescription>Add {selectedCount} selected {object.namePlural.toLowerCase()} to a list.</DialogDescription></DialogHeader>
          <Select value={listId} onValueChange={setListId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a list" /></SelectTrigger><SelectContent>{compatibleLists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}{!listsQuery.isPending && compatibleLists.length === 0 && <SelectItem value="none" disabled>No compatible lists</SelectItem>}</SelectContent></Select>
          <DialogFooter><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={!listId || bulk.isPending} onClick={() => void run({ type: 'addToList', listId })}>{bulk.isPending ? 'Adding…' : 'Add to list'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'owner'} onOpenChange={(open) => { if (!open && !bulk.isPending) setDialog(null) }}>
        <DialogContent><DialogHeader><DialogTitle>Change owner</DialogTitle><DialogDescription>Assign {selectedCount} selected {object.namePlural.toLowerCase()} to a teammate.</DialogDescription></DialogHeader>
          <Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose an owner" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{(membersQuery.data?.members ?? []).filter((member) => member.enabled).map((member) => <SelectItem key={member.userId} value={member.userId}>{memberDisplayName(member)}</SelectItem>)}</SelectContent></Select>
          <DialogFooter><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={!ownerUserId || bulk.isPending} onClick={() => void run({ type: 'changeOwner', ownerUserId: ownerUserId === 'unassigned' ? null : ownerUserId })}>{bulk.isPending ? 'Saving…' : 'Change owner'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === 'delete'} onOpenChange={(open) => { if (!open && !bulk.isPending) setDialog(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {selectedCount} {object.namePlural.toLowerCase()}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the selected records from this workspace.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={bulk.isPending}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={bulk.isPending} onClick={(event) => { event.preventDefault(); void run({ type: 'delete' }) }}>{bulk.isPending ? 'Deleting…' : 'Delete'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  )
}
