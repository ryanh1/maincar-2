import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateListAttribute } from '@/hooks/crm'
import type { AttributeType } from '@/lib/crmTypes'

const FIELD_TYPES: Array<{ value: AttributeType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
]

function fieldSlug(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(normalized) ? normalized : `field_${normalized}`
}

/** Adds an AttributeDef whose values live on ListEntry rather than the record. */
export function AddListFieldDialog({ open, onOpenChange, orgId, objectId }: { open: boolean; onOpenChange: (open: boolean) => void; orgId: string; objectId: string }) {
  const create = useCreateListAttribute()
  const [name, setName] = useState('')
  const [type, setType] = useState<AttributeType>('text')

  function close() {
    setName('')
    setType('text')
    onOpenChange(false)
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await create.mutateAsync({ orgId, objectId, name: trimmed, slug: fieldSlug(trimmed), type })
      toast.success(`Added ${trimmed}.`)
      close()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not add the list field. Try again.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !create.isPending) close() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add list field</DialogTitle>
          <DialogDescription>This value belongs to the list membership, not the record.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="list-field-name">Field name</Label>
            <Input id="list-field-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="list-field-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as AttributeType)}>
              <SelectTrigger id="list-field-type" className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map((fieldType) => <SelectItem key={fieldType.value} value={fieldType.value}>{fieldType.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" disabled={create.isPending} onClick={close}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => void submit()}>{create.isPending ? 'Adding' : 'Add field'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
