import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateList } from '@/hooks/crm'
import type { CrmList, ObjectDef } from '@/lib/crmTypes'

interface NewListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  object: Pick<ObjectDef, 'id' | 'slug' | 'name' | 'namePlural'>
  onCreated?: (list: CrmList) => void | Promise<void>
}

/** Creates a list from an object grid; its object cannot change after creation. */
export function NewListDialog({ open, onOpenChange, orgId, object, onCreated }: NewListDialogProps) {
  const createList = useCreateList()
  const [name, setName] = useState('')

  function setOpen(nextOpen: boolean) {
    if (!nextOpen) setName('')
    onOpenChange(nextOpen)
  }

  async function create() {
    try {
      const result = await createList.mutateAsync({ orgId, name, objectSlug: object.slug })
      await onCreated?.(result.list)
      toast.success(`Created ${result.list.name}.`)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not create the list. Try again.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Create a list for {object.namePlural.toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="new-list-name">List name</Label>
            <Input id="new-list-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="List name" autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-list-object">Object</Label>
            <Input id="new-list-object" value={object.namePlural} readOnly />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={createList.isPending}>Cancel</Button>
          <Button onClick={() => void create()} disabled={!name.trim() || createList.isPending}>{createList.isPending ? 'Creating…' : 'Create list'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
