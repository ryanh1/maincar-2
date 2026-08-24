import { useRef, useState } from 'react'
import { MoreHorizontal, GripVertical, Plus, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AccountTimelineRecordTab } from '@/components/account-timeline/AccountTimelineRecordTab'
import { ActivityFeedRow } from '@/components/activity-feed/ActivityFeedRow'
import { mapActivityEntry } from '@/components/activity-feed/activityFeed'
import { PageHeader } from '@/components/PageHeader'
import { RecordTypeIcon } from '@/components/RecordTypeIcon'
import { FieldValueEditor } from '@/components/crm/FieldValueEditor'
import { OptionChip } from '@/components/crm/OptionChip'
import { parseOptions } from '@/components/crm/cellBuilder'
import { formatCellValue } from '@/components/crm/recordCellValue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGetActivity, useGetDetailLayout, useGetObject, useGetObjects, useListRecords, useSaveDetailLayout, useUpdateRecordValue, type ActivityScope, type DetailLayoutSection } from '@/hooks/crm'
import type { AccountTimelineRoot } from '@/lib/accountTimelineTypes'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
import { useAuth } from '@/providers/useAuth'

type DragLocation = { slug: string; sectionIndex: number | null }

const ACTIVITY_SCOPE_SLUG: Record<string, 'companyId' | 'personId' | 'dealId'> = {
  company: 'companyId',
  person: 'personId',
  deal: 'dealId',
}

const FEED_KIND_OPTIONS = [
  { value: 'call', label: 'Calls' },
  { value: 'email', label: 'Emails' },
  { value: 'sms', label: 'Texts' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'note', label: 'Notes' },
  { value: 'task', label: 'Tasks' },
  { value: 'stage_change', label: 'Changes' },
] as const

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
  const activityScopeKey = object && record ? ACTIVITY_SCOPE_SLUG[object.slug] : undefined
  const activityScope: ActivityScope | null = activityScopeKey && record ? { [activityScopeKey]: record.id } as ActivityScope : null
  const activityQuery = useGetActivity(orgId, activityScope, { limit: 20 })
  const [editingLayout, setEditingLayout] = useState(false)
  const [draftSections, setDraftSections] = useState<DetailLayoutSection[]>([])
  const [draftRailObjects, setDraftRailObjects] = useState<string[]>([])
  const [draftFeedKinds, setDraftFeedKinds] = useState<string[]>([])
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({})
  const [activeTab, setActiveTab] = useState<'details' | 'timeline'>('details')
  const dragLocation = useRef<DragLocation | null>(null)

  const savedLayout = layoutQuery.data?.layout
  const savedSections = normalizeSections(savedLayout?.id ? savedLayout.sections : defaultSections(attributes ?? []), attributes ?? [])
  const savedRailObjects = savedLayout?.railObjects ?? []
  const savedFeedKinds = savedLayout?.feedKinds ?? []
  const activeSections = editingLayout ? draftSections : savedSections
  const activeRailObjects = editingLayout ? draftRailObjects : savedRailObjects
  const activeFeedKinds = editingLayout ? draftFeedKinds : savedFeedKinds
  const placedSlugs = new Set(activeSections.flatMap((section) => section.fields.map((field) => field.slug)))
  const hiddenAttributes = (attributes ?? []).filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived && !placedSlugs.has(attribute.slug))
  const displayedRecord = record ? { ...record, ...localValues } : null
  const identity = attributes?.find((attribute) => attribute.isIdentity) ?? attributes?.[0]
  const title = identity && displayedRecord ? formatCellValue(displayedRecord[identity.slug], identity.type, user?.timeZone) : object?.name ?? 'Record'
  const timelineRoot: AccountTimelineRoot | null = displayedRecord && (object?.slug === 'company' || object?.slug === 'deal')
    ? { type: object.slug, id: displayedRecord.id }
    : null

  function startEditingLayout() {
    setActiveTab('details')
    setDraftSections(savedSections)
    setDraftRailObjects(savedRailObjects)
    setDraftFeedKinds(savedFeedKinds)
    setEditingLayout(true)
  }

  function discardLayout() {
    setDraftSections(savedSections)
    setDraftRailObjects(savedRailObjects)
    setDraftFeedKinds(savedFeedKinds)
    setEditingLayout(false)
  }

  async function persistLayout() {
    if (!orgId || !object) return
    try {
      await saveLayout.mutateAsync({
        orgId,
        objectId: object.id,
        sections: normalizeSections(draftSections, attributes ?? []),
        railObjects: draftRailObjects,
        feedKinds: draftFeedKinds,
      })
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
        iconNode={<RecordTypeIcon icon={object?.icon} color={object?.iconColor} aria-hidden />}
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

      <Tabs
        value={timelineRoot ? activeTab : 'details'}
        onValueChange={(value) => setActiveTab(value as 'details' | 'timeline')}
        className="min-h-0 flex-1 gap-0"
      >
        {timelineRoot && object && (
          <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-6">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/records/${object.slug}`}>
                {object.namePlural}
              </Link>
              <span aria-hidden className="text-text-muted">/</span>
              <span aria-current="page" className="truncate text-text-muted">{title}</span>
            </nav>
            <TabsList variant="line" aria-label={`${object.name} record views`} className="h-12">
              <TabsTrigger value="details" className="h-8 flex-none px-3">Details</TabsTrigger>
              <TabsTrigger value="timeline" className="h-8 flex-none px-3">Timeline</TabsTrigger>
            </TabsList>
          </div>
        )}
        <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto p-6">
        {isPending && <p className="text-sm text-muted-foreground">Loading record…</p>}
        {!isPending && isError && <p className="text-sm text-destructive">Could not load this record.</p>}
        {!isPending && !isError && (!object || !displayedRecord) && <p className="text-sm text-muted-foreground">This record no longer exists.</p>}
        {!isPending && !isError && object && displayedRecord && (
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            {editingLayout && (
              <div className="border border-border bg-surface p-3 text-sm text-muted-foreground">
                Editing the shared {object.name.toLowerCase()} layout. Drag fields between sections and Hidden fields; the two-column grid snaps each field to half or full width.
              </div>
            )}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.9fr)_16rem]">
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
              <ActivityRegion activity={activityQuery.data?.activity ?? []} isPending={activityQuery.isPending} isError={activityQuery.isError} scope={activityScope} feedKinds={activeFeedKinds} timeZone={user?.timeZone} />
              {editingLayout ? (
                <LayoutEditorRail
                  hiddenAttributes={hiddenAttributes}
                  draftRailObjects={draftRailObjects}
                  draftFeedKinds={draftFeedKinds}
                  objects={objectsQuery.data?.objects ?? []}
                  currentObjectId={object.id}
                  onDropField={() => {
                    const drag = dragLocation.current
                    if (drag) moveField(drag.slug, null)
                    dragLocation.current = null
                  }}
                  onDragStart={(slug) => { dragLocation.current = { slug, sectionIndex: null } }}
                  onShowField={(slug) => moveField(slug, 0)}
                  onRailObjectsChange={setDraftRailObjects}
                  onFeedKindsChange={setDraftFeedKinds}
                />
              ) : (
                <RelatedRail objects={objectsQuery.data?.objects ?? []} activeRailObjects={activeRailObjects} currentObjectId={object.id} />
              )}
            </div>
          </div>
        )}
        </TabsContent>
        {timelineRoot && orgId && object && (
          <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto p-6">
            <AccountTimelineRecordTab orgId={orgId} objectId={object.id} root={timelineRoot} timeZone={user?.timeZone} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function ActivityRegion({
  activity,
  isPending,
  isError,
  scope,
  feedKinds,
  timeZone,
}: {
  activity: Array<Parameters<typeof mapActivityEntry>[0]>
  isPending: boolean
  isError: boolean
  scope: ActivityScope | null
  feedKinds: string[]
  timeZone: string | null | undefined
}) {
  const visibleActivity = feedKinds.length === 0
    ? activity
    : activity.filter((entry) => feedKinds.includes(entry.sourceType))

  return (
    <section className="border border-border bg-bg">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">Activity</h2>
        <p className="mt-1 text-xs text-text-muted">Recent activity for this record.</p>
      </div>
      <div>
        {!scope && <p className="p-4 text-sm text-text-muted">Activity is not available for this object yet.</p>}
        {scope && isPending && <p className="p-4 text-sm text-text-muted">Loading activity…</p>}
        {scope && isError && <p className="p-4 text-sm text-destructive">Could not load activity.</p>}
        {scope && !isPending && !isError && visibleActivity.length === 0 && (
          <p className="p-4 text-sm text-text-muted">No matching activity yet.</p>
        )}
        {scope && !isPending && !isError && visibleActivity.length > 0 && (
          <div>
            {visibleActivity.map((entry) => (
              <ActivityFeedRow key={entry.id} item={mapActivityEntry(entry)} timeZone={timeZone} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function RelatedRail({
  objects,
  activeRailObjects,
  currentObjectId,
}: {
  objects: Array<Pick<ObjectDef, 'id' | 'slug' | 'namePlural' | 'icon' | 'iconColor'>>
  activeRailObjects: string[]
  currentObjectId: string
}) {
  const relatedObjects = objects.filter((candidate) =>
    candidate.id !== currentObjectId && (activeRailObjects.includes(candidate.id) || activeRailObjects.includes(candidate.slug)),
  )

  return (
    <aside className="h-fit border border-border bg-surface">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">Related</h2>
        <p className="mt-1 text-xs text-text-muted">Objects selected for this record page.</p>
      </div>
      {relatedObjects.length > 0 ? (
        <ul className="divide-y divide-border">
          {relatedObjects.map((relatedObject) => (
            <li key={relatedObject.id} className="flex items-center gap-2 p-3 text-sm">
              <RecordTypeIcon icon={relatedObject.icon} color={relatedObject.iconColor} aria-hidden />
              {relatedObject.namePlural}
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-text-muted">No related objects configured.</p>
      )}
    </aside>
  )
}

function LayoutEditorRail({
  hiddenAttributes,
  draftRailObjects,
  draftFeedKinds,
  objects,
  currentObjectId,
  onDropField,
  onDragStart,
  onShowField,
  onRailObjectsChange,
  onFeedKindsChange,
}: {
  hiddenAttributes: AttributeDef[]
  draftRailObjects: string[]
  draftFeedKinds: string[]
  objects: Array<Pick<ObjectDef, 'id' | 'slug' | 'namePlural' | 'icon' | 'iconColor'>>
  currentObjectId: string
  onDropField: () => void
  onDragStart: (slug: string) => void
  onShowField: (slug: string) => void
  onRailObjectsChange: (values: string[]) => void
  onFeedKindsChange: (values: string[]) => void
}) {
  const availableObjects = objects.filter((candidate) => candidate.id !== currentObjectId)

  function toggleValue(values: string[], value: string, checked: boolean, update: (next: string[]) => void) {
    update(checked ? [...values, value] : values.filter((candidate) => candidate !== value))
  }

  return (
    <aside
      className="h-fit border border-border bg-surface p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => {
        onDropField()
      }}
    >
      <h2 className="mb-3 text-sm font-semibold">Layout options</h2>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-text-muted">Hidden fields</p>
          <div className="flex flex-col gap-2">
            {hiddenAttributes.map((attribute) => (
              <div key={attribute.id} draggable onDragStart={() => onDragStart(attribute.slug)} className="flex items-center justify-between border border-border bg-bg p-2 text-sm">
                <span className="flex items-center gap-1"><GripVertical aria-label={`Drag ${attribute.name}`} size={16} />{attribute.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onShowField(attribute.slug)}>Show</Button>
              </div>
            ))}
            {hiddenAttributes.length === 0 && <p className="text-sm text-text-muted">No hidden fields.</p>}
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-text-muted">Related objects</legend>
          <div className="flex flex-col gap-2">
            {availableObjects.map((candidate) => (
              <label key={candidate.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draftRailObjects.includes(candidate.slug) || draftRailObjects.includes(candidate.id)}
                  onCheckedChange={(checked) => toggleValue(draftRailObjects.filter((value) => value !== candidate.id && value !== candidate.slug), candidate.slug, checked === true, onRailObjectsChange)}
                />
                <RecordTypeIcon icon={candidate.icon} color={candidate.iconColor} aria-hidden />
                {candidate.namePlural}
              </label>
            ))}
            {availableObjects.length === 0 && <p className="text-sm text-text-muted">No other objects available.</p>}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-text-muted">Activity feed</legend>
          <div className="flex flex-col gap-2">
            {FEED_KIND_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draftFeedKinds.includes(option.value)}
                  onCheckedChange={(checked) => toggleValue(draftFeedKinds, option.value, checked === true, onFeedKindsChange)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-muted">Clear all to show every activity type.</p>
        </fieldset>
      </div>
    </aside>
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
