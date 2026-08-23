import { useState } from 'react'
import { toast } from 'sonner'

import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateObject, useUpdateObject } from '@/hooks/crm'
import type { ObjectDef } from '@/lib/crmTypes'

interface ObjectEditorProps {
  orgId: string
  object: ObjectDef | null
  objects: ObjectDef[]
  onClose: () => void
  onSaved: (object: ObjectDef) => void
}

interface ObjectForm {
  name: string
  namePlural: string
  slug: string
  icon: string
}

function initialForm(object: ObjectDef | null): ObjectForm {
  return object
    ? { name: object.name, namePlural: object.namePlural, slug: object.slug, icon: object.icon ?? 'database' }
    : { name: '', namePlural: '', slug: '', icon: 'database' }
}

/** Creates or edits one object's user-facing identity. */
export function Settings_DataModelTab_ObjectEditor({ orgId, object, objects, onClose, onSaved }: ObjectEditorProps) {
  const [form, setForm] = useState<ObjectForm>(() => initialForm(object))
  const createObject = useCreateObject()
  const updateObject = useUpdateObject()
  const isEditing = object !== null
  const isSaving = createObject.isPending || updateObject.isPending
  const assignments = objects
    .filter((candidate) => candidate.id !== object?.id)
    .map((candidate) => ({ icon: candidate.icon, objectName: candidate.namePlural }))

  async function save() {
    try {
      const response = isEditing
        ? await updateObject.mutateAsync({
          orgId,
          objectId: object.id,
          name: form.name.trim(),
          namePlural: form.namePlural.trim(),
          icon: form.icon,
        })
        : await createObject.mutateAsync({
          orgId,
          slug: form.slug.trim(),
          name: form.name.trim(),
          namePlural: form.namePlural.trim(),
          icon: form.icon,
        })
      toast.success(isEditing ? 'Object updated.' : 'Object created.')
      onSaved(response.object)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not save the object. Try again.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSaving) onClose() }}>
      <DialogContent showCloseButton={!isSaving} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{isEditing ? 'Edit object' : 'New object'}</DialogTitle>
          <DialogDescription>Names and icon appear anywhere this object is shown.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="object-name">Name</Label>
            <Input id="object-name" className="h-8" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="object-name-plural">Plural name</Label>
            <Input id="object-name-plural" className="h-8" required value={form.namePlural} onChange={(event) => setForm((current) => ({ ...current, namePlural: event.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="object-slug">Slug</Label>
            <Input id="object-slug" className="h-8" required disabled={isEditing} pattern="[a-z][a-z0-9_]*" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} />
            {!isEditing && <p className="text-xs text-text-muted">Use lowercase letters, numbers, and underscores.</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label>Icon</Label>
            <IconPicker value={form.icon} assignments={assignments} disabled={isSaving} onValueChange={(icon) => setForm((current) => ({ ...current, icon }))} />
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={isSaving} onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSaving}>{isSaving ? 'Saving' : isEditing ? 'Save object' : 'Create object'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
