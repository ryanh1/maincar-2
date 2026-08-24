import { useState } from 'react'
import { toast } from 'sonner'

import { RecordTypeIcon } from '@/components/RecordTypeIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGetObject, useGetObjects, useUpdateAttribute } from '@/hooks/crm'
import type { AttributeDef, FieldFormat, FieldValidation, ObjectDef } from '@/lib/crmTypes'
import { useAuth } from '@/providers/useAuth'

import { Settings_DataModelTab_ObjectEditor } from './Settings_DataModelTab_ObjectEditor'

const NUMBER_STYLES = [
  { value: 'decimal', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
] as const

const DATE_PRESETS = [
  { value: 'short', label: 'Short (6/24/26)' },
  { value: 'medium', label: 'Medium (Jun 24, 2026)' },
  { value: 'long', label: 'Long (June 24, 2026)' },
  { value: 'full', label: 'Full (Wednesday, June 24, 2026)' },
] as const

const NUMBER_TYPES = new Set(['number', 'currency', 'rating'])
const DATE_TYPES = new Set(['date', 'timestamp'])
const TEXT_TYPES = new Set(['text', 'phone', 'email', 'url', 'domain', 'person_name', 'location'])

function asFormat(value: unknown): FieldFormat {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as FieldFormat) : {}
}

function asValidation(value: unknown): FieldValidation {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as FieldValidation) : {}
}

/** The Format & validation editor for one field (MAI-365). */
function FieldConfigEditor({ orgId, objectId, attribute, onClose }: { orgId: string; objectId: string; attribute: AttributeDef; onClose: () => void }) {
  const updateAttribute = useUpdateAttribute()
  const [format, setFormat] = useState<FieldFormat>(() => asFormat(attribute.formatJson))
  const [validation, setValidation] = useState<FieldValidation>(() => asValidation(attribute.validationJson))

  const isNumber = NUMBER_TYPES.has(attribute.type)
  const isDate = DATE_TYPES.has(attribute.type)
  const isText = TEXT_TYPES.has(attribute.type)

  function setNumberFormat(patch: Partial<NonNullable<FieldFormat['number']>>) {
    setFormat((current) => ({ ...current, number: { ...current.number, ...patch } }))
  }

  async function save() {
    try {
      await updateAttribute.mutateAsync({
        orgId,
        attributeId: attribute.id,
        objectId,
        formatJson: format,
        validationJson: validation,
      })
      toast.success('Field format saved.')
      onClose()
    } catch {
      toast.error('Could not save the field format. Try again.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !updateAttribute.isPending) onClose() }}>
      <DialogContent showCloseButton={!updateAttribute.isPending} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Format & validation</DialogTitle>
          <DialogDescription>{attribute.name} — display and entry rules for this field.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {isNumber && (
            <section className="flex flex-col gap-3 border border-border p-3">
              <h3 className="text-sm font-semibold">Number format</h3>
              <div className="flex flex-col gap-1">
                <Label>Style</Label>
                <Select value={format.number?.style ?? 'decimal'} onValueChange={(style) => setNumberFormat({ style: style as NonNullable<FieldFormat['number']>['style'] })}>
                  <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{NUMBER_STYLES.map((style) => <SelectItem key={style.value} value={style.value}>{style.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {format.number?.style === 'currency' && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="field-currency">Currency</Label>
                  <Input id="field-currency" className="h-8" value={format.number.currency ?? 'USD'} onChange={(event) => setNumberFormat({ currency: event.target.value })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="field-min-fraction">Min decimals</Label>
                  <Input id="field-min-fraction" className="h-8" inputMode="numeric" value={format.number?.minimumFractionDigits ?? ''} placeholder="0" onChange={(event) => setNumberFormat({ minimumFractionDigits: event.target.value === '' ? undefined : Number(event.target.value) })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="field-max-fraction">Max decimals</Label>
                  <Input id="field-max-fraction" className="h-8" inputMode="numeric" value={format.number?.maximumFractionDigits ?? ''} placeholder="2" onChange={(event) => setNumberFormat({ maximumFractionDigits: event.target.value === '' ? undefined : Number(event.target.value) })} />
                </div>
              </div>
            </section>
          )}

          {isDate && (
            <section className="flex flex-col gap-3 border border-border p-3">
              <h3 className="text-sm font-semibold">Date format</h3>
              <div className="flex flex-col gap-1">
                <Label>Preset</Label>
                <Select value={format.date?.preset ?? 'medium'} onValueChange={(preset) => setFormat((current) => ({ ...current, date: { preset: preset as NonNullable<FieldFormat['date']>['preset'] } }))}>
                  <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{DATE_PRESETS.map((preset) => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </section>
          )}

          {isText && (
            <section className="flex flex-col gap-3 border border-border p-3">
              <h3 className="text-sm font-semibold">Text pattern</h3>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-pattern">Pattern (regular expression)</Label>
                <Input id="field-pattern" className="h-8" value={validation.pattern ?? ''} placeholder="^[A-Z]{3}-[0-9]+$" onChange={(event) => setValidation((current) => ({ ...current, pattern: event.target.value || undefined }))} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-message">Message when it does not match</Label>
                <Input id="field-message" className="h-8" value={validation.message ?? ''} placeholder="Use a SKU like ABC-123." onChange={(event) => setValidation((current) => ({ ...current, message: event.target.value || undefined }))} />
              </div>
            </section>
          )}

          {isNumber && (
            <section className="flex flex-col gap-3 border border-border p-3">
              <h3 className="text-sm font-semibold">Range</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="field-min">Minimum</Label>
                  <Input id="field-min" className="h-8" inputMode="decimal" value={validation.min ?? ''} placeholder="None" onChange={(event) => setValidation((current) => ({ ...current, min: event.target.value === '' ? undefined : Number(event.target.value) }))} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="field-max">Maximum</Label>
                  <Input id="field-max" className="h-8" inputMode="decimal" value={validation.max ?? ''} placeholder="None" onChange={(event) => setValidation((current) => ({ ...current, max: event.target.value === '' ? undefined : Number(event.target.value) }))} />
                </div>
              </div>
            </section>
          )}

          {(isNumber || isText) && (
            <div className="flex items-start justify-between gap-3 border border-border p-3">
              <div>
                <Label htmlFor="field-strict">Block invalid entries</Label>
                <p className="mt-1 text-xs text-text-muted">When off, an entry that breaks a rule is saved and flagged. When on, it is refused.</p>
              </div>
              <Switch id="field-strict" checked={validation.strict === true} onCheckedChange={(strict) => setValidation((current) => ({ ...current, strict }))} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={updateAttribute.isPending} onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={updateAttribute.isPending} onClick={() => void save()}>{updateAttribute.isPending ? 'Saving' : 'Save format'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings → Data model: pick an object, then edit a field's Format & validation. */
export function Settings_DataModelTab() {
  const { org, isAdmin } = useAuth()
  const objectsQuery = useGetObjects(org?.id)
  const [objectId, setObjectId] = useState<string | null>(null)
  const objectQuery = useGetObject(org?.id, objectId)
  const [editingField, setEditingField] = useState<AttributeDef | null>(null)
  const [editingObject, setEditingObject] = useState<ObjectDef | 'new' | null>(null)

  if (!org) return null

  const objects = (objectsQuery.data?.objects ?? []).filter((object) => !object.isArchived)
  const selectedObject = objects.find((object) => object.id === objectId) ?? null
  const attributes = (objectQuery.data?.object.attributes ?? []).filter((attribute) => !attribute.isArchived)
  const loading = objectsQuery.isPending || (objectId !== null && objectQuery.isPending)
  const loadError = objectsQuery.isError || objectQuery.isError

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Data model</h2>
          <p className="mt-1 text-xs text-text-muted">Choose an object, then set how each field displays and validates.</p>
        </div>
        {isAdmin && <Button type="button" size="sm" onClick={() => setEditingObject('new')}>New object</Button>}
      </div>
      {!isAdmin && <p className="text-xs text-text-muted">Only an admin can change the data model.</p>}

      <div className="flex items-end gap-2">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <Label htmlFor="data-model-object">Object</Label>
          <Select value={objectId ?? ''} disabled={!isAdmin} onValueChange={(value) => setObjectId(value || null)}>
            <SelectTrigger id="data-model-object" className="h-8 w-full"><SelectValue placeholder="Choose an object" /></SelectTrigger>
            <SelectContent>{objects.map((object) => <SelectItem key={object.id} value={object.id}><RecordTypeIcon icon={object.icon} color={object.iconColor} aria-hidden />{object.namePlural}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selectedObject && <Button type="button" size="sm" variant="secondary" disabled={!isAdmin} onClick={() => setEditingObject(selectedObject)}>Edit object</Button>}
      </div>

      {loading && <p className="text-sm text-text-muted">Loading fields.</p>}
      {loadError && <p className="text-sm text-destructive">Could not load fields.</p>}
      {!loading && !loadError && objectId && (
        <div className="overflow-x-auto border border-border">
          <table className="w-full">
            <caption className="sr-only">Fields for the selected object</caption>
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Field</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Type</th>
                <th className="w-36 px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {attributes.map((attribute) => (
                <tr key={attribute.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-sm">{attribute.name}</td>
                  <td className="px-3 py-2 text-sm text-text-muted">{attribute.type}</td>
                  <td className="px-3 py-1 text-right">
                    <Button type="button" size="sm" variant="secondary" disabled={!isAdmin} onClick={() => setEditingField(attribute)}>Format</Button>
                  </td>
                </tr>
              ))}
              {attributes.length === 0 && <tr><td colSpan={3} className="px-3 py-2 text-sm text-text-muted">This object has no fields.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editingField && objectId && (
        <FieldConfigEditor orgId={org.id} objectId={objectId} attribute={editingField} onClose={() => setEditingField(null)} />
      )}
      {editingObject && (
        <Settings_DataModelTab_ObjectEditor
          orgId={org.id}
          object={editingObject === 'new' ? null : editingObject}
          objects={objects}
          onClose={() => setEditingObject(null)}
          onSaved={(savedObject) => { setObjectId(savedObject.id); setEditingObject(null) }}
        />
      )}
    </section>
  )
}
