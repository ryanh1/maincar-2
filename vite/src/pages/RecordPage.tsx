import { useRef, useState } from 'react'
import { MoreHorizontal, PanelTop, GripVertical, Plus, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/PageHeader'
import { FieldValueEditor } from '@/components/crm/FieldValueEditor'
import { OptionChip } from '@/components/crm/OptionChip'
import { parseOptions } from '@/components/crm/cellBuilder'
import { formatCellValue } from '@/components/crm/recordCellValue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useGetDetailLayout, useGetObject, useGetObjects, useListRecords, useSaveDetailLayout, useUpdateRecordValue, type DetailLayoutSection } from '@/hooks/crm'
import type { AttributeDef, RecordRow } from '@/lib/crmTypes'
import { useAuth } from '@/providers/useAuth'

type DragLocation = { slug: string; sectionIndex: number | null }

function defaultSections(attributes: AttributeDef[]): DetailLayoutSection[] {
  return [{
    name: 'Details',
    order: 0,
    fields: attributes
      .filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((attribute) => ({ slug: attribute.slug, width: attribute.isIdentity ? 2 : 1 })),
  }]
}

function normalizeSections(sections: DetailLayoutSection[], attributes: AttributeDef[]) {
  const allowed = new Set(attributes.filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived).map((attribute) => attribute.slug))
  const seen = new Set<string>()
  const cleaned = sections.map((section, order) => ({
    name: section.name.trim() || `Section ${order + 1}`,
    order,
    fields: section.fields.filter((field) => {
      if (!allowed.has(field.slug) || seen.has(field.slug)) return false
      seen.add(field.slug)
      return true
    }),
  }))
  return cleaned.length > 0 ? cleaned : defaultSections(attributes)
}

/** The standalone, shareable record detail surface. Its layout remains inert until Edit layout begins. */
export function RecordPage() {
  const { slug, recordId } = useParams<{ slug: string; recordId: string }>()
  const { org, user } = useAuth()
  const orgId = org?.id ?? null
  const objectsQuery = useGetObjects(orgId)
  const object = objectsQuery.data?.objects.find((candidate) => candidate.slug === slug) ?? null
  const objectQuery = useGetObject(orgId, object?.id ?? null)
  const attributes = objectQuery.data?.object.attributes
  const recordQuery = useListRecords(orgId, object?.id ?? null, {
    filter: recordId ? { type: 'condition', field: 'id', operator: 'eq', value: recordId } : undefined,
  })
  const record = recordQuery.data?.pages.flatMap((page) => page.rows)[0] ?? null
  const layoutQuery = useGetDetailLayout(orgId, object?.id ?? null)
  const saveLayout = useSaveDetailLayout()
  const updateRecord = useUpdateRecordValue()
  const [editingLayout, setEditingLayout] = useState(false)
  const [draftSections, setDraftSections] = useState<DetailLayoutSection[]>([])
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({})
  const dragLocation = useRef<DragLocation | null>(null)

  const savedSections = normalizeSections(layoutQuery.data?.layout.id ? layoutQuery.data.layout.sections : defaultSections(attributes ?? []), attributes ?? [])
  const activeSections = editingLayout ? draftSections : savedSections
  const placedSlugs = new Set(activeSections.flatMap((section) => section.fields.map((field) => field.slug)))
  const hiddenAttributes = (attributes ?? []).filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived && !placedSlugs.has(attribute.slug))
  const displayedRecord = record ? { ...record, ...localValues } : null
  const identity = attributes?.find((attribute) => attribute.isIdentity) ?? attributes?.[0]
  const title = identity && displayedRecord ? formatCellValue(displayedRecord[identity.slug], identity.type, user?.timeZone) : object?.name ?? 'Record'

  function startEditingLayout() {
    setDraftSections(savedSections)
    setEditingLayout(true)
  }

  function discardLayout() {
    setDraftSections(savedSections)
    setEditingLayout(false)
  }

  async function persistLayout() {
    if (!orgId || !object) return
    try {
      await saveLayout.mutateAsync({ orgId, objectId: object.id, sections: normalizeSections(draftSections, attributes ?? []) })
      setEditingLayout(false)
      toast.success('Record layout saved for everyone.')
    } catch {
      toast.error('Could not save the record layout. Try again.')
    }
  }

  function moveField(slugToMove: string, targetSectionIndex: number | null) {
    setDraftSections((current) => {
      const withoutField = current.map((section) => ({ ...section, fields: section.fields.filter((field) => field.slug !== slugToMove) }))
      if (targetSectionIndex === null) return withoutField
      const target = withoutField[targetSectionIndex]
      if (!target) return withoutField
      const attribute = attributes?.find((candidate) => candidate.slug === slugToMove)
      const width = attribute?.isIdentity ? 2 : 1
      return withoutField.map((section, index) => index === targetSectionIndex
        ? { ...section, fields: [...section.fields, { slug: slugToMove, width }] }
        : section)
    })
  }

  function updateSection(index: number, update: (section: DetailLayoutSection) => DetailLayoutSection) {
    setDraftSections((current) => current.map((section, sectionIndex) => sectionIndex === index ? update(section) : section))
  }

  async function saveField(attribute: AttributeDef, value: unknown) {
    if (!object || !displayedRecord || attribute.isReadOnly || JSON.stringify(displayedRecord[attribute.slug]) === JSON.stringify(value)) return
    const prior = localValues
    setLocalValues((current) => ({ ...current, [attribute.slug]: value }))
    try {
      await updateRecord.mutateAsync({ orgId: orgId!, object, attribute, recordId: displayedRecord.id, value })
    } catch {
      setLocalValues(prior)
      toast.error('Could not save. Check your connection and try again.')
    }
  }

  const isPending = objectsQuery.isPending || objectQuery.isPending || recordQuery.isPending || layoutQuery.isPending
  const isError = objectsQuery.isError || objectQuery.isError || recordQuery.isError || layoutQuery.isError

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={PanelTop}
        title={title}
        action={editingLayout ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={discardLayout}>Discard</Button>
            <Button type="button" size="sm" disabled={saveLayout.isPending} onClick={() => void persistLayout()}>Save layout</Button>
          </div>
        ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
              <IconButton type="button" variant="secondary" tooltip="Show record actions">
                <MoreHorizontal size={16} aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={startEditingLayout}>Edit layout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isPending && <p className="text-sm text-muted-foreground">Loading record…</p>}
        {!isPending && isError && <p className="text-sm text-destructive">Could not load this record.</p>}
        {!isPending && !isError && (!object || !displayedRecord) && <p className="text-sm text-muted-foreground">This record no longer exists.</p>}
        {!isPending && !isError && object && displayedRecord && (
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            {editingLayout && (
              <div className="border border-border bg-surface p-3 text-sm text-muted-foreground">
                Editing the shared {object.name.toLowerCase()} layout. Drag fields between a section and Hidden fields; the two-column grid snaps each field to half or full width.
              </div>
            )}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="flex flex-col gap-6">
                {activeSections.map((section, sectionIndex) => (
                  <section
                    key={`${section.name}-${sectionIndex}`}
                    className="border border-border bg-bg p-4"
                    onDragOver={editingLayout ? (event) => event.preventDefault() : undefined}
                    onDrop={editingLayout ? () => {
                      const drag = dragLocation.current
                      if (drag) moveField(drag.slug, sectionIndex)
                      dragLocation.current = null
                    } : undefined}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      {editingLayout ? (
                        <Input aria-label={`Section ${sectionIndex + 1} name`} value={section.name} onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, name: event.target.value }))} />
                      ) : <h2 className="text-sm font-semibold">{section.name}</h2>}
                      {editingLayout && activeSections.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setDraftSections((current) => current.filter((_, index) => index !== sectionIndex))}>
                          <X size={16} aria-hidden /> Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {section.fields.map((field) => {
                        const attribute = attributes?.find((candidate) => candidate.slug === field.slug)
                        if (!attribute) return null
                        return (
                          <div
                            key={field.slug}
                            draggable={editingLayout}
                            className={field.width === 2 ? 'sm:col-span-2' : undefined}
                            onDragStart={editingLayout ? () => { dragLocation.current = { slug: field.slug, sectionIndex } } : undefined}
                          >
                            {editingLayout ? (
                              <LayoutField
                                attribute={attribute}
                                width={field.width}
                                onHide={() => moveField(field.slug, null)}
                                onWidthChange={() => updateSection(sectionIndex, (current) => ({
                                  ...current,
                                  fields: current.fields.map((candidate) => candidate.slug === field.slug ? { ...candidate, width: candidate.width === 1 ? 2 : 1 } : candidate),
                                }))}
                              />
                            ) : (
                              <RecordField attribute={attribute} record={displayedRecord} timeZone={user?.timeZone} orgId={orgId!} onSave={saveField} />
                            )}
                          </div>
                        )
                      })}
                      {editingLayout && section.fields.length === 0 && <div className="border border-dashed border-border p-3 text-sm text-muted-foreground sm:col-span-2">Drop fields here.</div>}
                    </div>
                  </section>
                ))}
                {editingLayout && (
                  <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setDraftSections((current) => [...current, { name: 'New section', fields: [], order: current.length }])}>
                    <Plus size={16} aria-hidden /> Add section
                  </Button>
                )}
              </div>
              {editingLayout && (
                <aside
                  className="h-fit border border-border bg-surface p-3"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const drag = dragLocation.current
                    if (drag) moveField(drag.slug, null)
                    dragLocation.current = null
                  }}
                >
                  <h2 className="mb-3 text-sm font-semibold">Hidden fields</h2>
                  <div className="flex flex-col gap-2">
                    {hiddenAttributes.map((attribute) => (
                      <div key={attribute.id} draggable onDragStart={() => { dragLocation.current = { slug: attribute.slug, sectionIndex: null } }} className="flex items-center justify-between border border-border bg-bg p-2 text-sm">
                        <span className="flex items-center gap-1"><GripVertical aria-label={`Drag ${attribute.name}`} size={16} />{attribute.name}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => moveField(attribute.slug, 0)}>Show</Button>
                      </div>
                    ))}
                    {hiddenAttributes.length === 0 && <p className="text-sm text-muted-foreground">No hidden fields.</p>}
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LayoutField({ attribute, width, onHide, onWidthChange }: { attribute: AttributeDef; width: 1 | 2; onHide: () => void; onWidthChange: () => void }) {
  return (
    <div className="flex h-8 items-center justify-between border border-border bg-surface px-2 text-sm">
      <span className="flex min-w-0 items-center gap-1"><GripVertical aria-label={`Drag ${attribute.name}`} size={16} /><span className="truncate">{attribute.name}</span></span>
      <span className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onHide}>Hide</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onWidthChange}>{width === 1 ? 'Full width' : 'Half width'}</Button>
      </span>
    </div>
  )
}

function RecordField({ attribute, record, timeZone, orgId, onSave }: { attribute: AttributeDef; record: RecordRow; timeZone: string | null | undefined; orgId: string; onSave: (attribute: AttributeDef, value: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const rawValue = record[attribute.slug]
  return (
    <div className="border border-border p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{attribute.name}</p>
      {editing ? (
        <FieldValueEditor orgId={orgId} attribute={attribute} value={rawValue} timeZone={timeZone} onCommit={(value) => { setEditing(false); void onSave(attribute, value) }} onCancel={() => setEditing(false)} />
      ) : (
        <Button type="button" variant="ghost" size="sm" disabled={attribute.isReadOnly} className="w-full justify-start px-0 text-left" onClick={() => setEditing(true)}>
          <FieldValue attribute={attribute} rawValue={rawValue} timeZone={timeZone} currencyCode={typeof record.currency === 'string' ? record.currency : undefined} />
        </Button>
      )}
    </div>
  )
}

function FieldValue({ attribute, rawValue, timeZone, currencyCode }: { attribute: AttributeDef; rawValue: unknown; timeZone: string | null | undefined; currencyCode?: string }) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return <span className="text-muted-foreground">—</span>
  if (attribute.type === 'select' || attribute.type === 'status' || attribute.type === 'multiselect') {
    const options = parseOptions(attribute.optionsJson)
    return <span className="flex flex-wrap gap-1">{(Array.isArray(rawValue) ? rawValue : [rawValue]).map((value) => {
      const option = options.find((candidate) => candidate.value === value)
      return <OptionChip key={String(value)} label={option?.label ?? String(value)} color={option?.color} />
    })}</span>
  }
  return <span>{formatCellValue(rawValue, attribute.type, timeZone, currencyCode, attribute.slug === 'amountMinor', attribute.formatJson)}</span>
}
