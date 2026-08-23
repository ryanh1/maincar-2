import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import { ActivityFeedRow } from '@/components/activity-feed/ActivityFeedRow'
import { mapActivityEntry } from '@/components/activity-feed/activityFeed'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGetActivity, useGetRelatedRecords, type ActivityScope } from '@/hooks/crm'
import type { AttributeDef, ObjectDef, RecordRow, RelatedRecordGroup } from '@/lib/crmTypes'
import { resolveOptionColor } from '@/lib/optionPalette'
import { parseOptions } from './cellBuilder'
import { FieldValueEditor } from './FieldValueEditor'
import { OptionChip } from './OptionChip'
import { RecordNoteComposer } from './RecordNoteComposer'
import { formatCellValue } from './recordCellValue'

// The three standard objects the activity feed can be scoped to
// (server/src/crm/standardObjects.ts). Any other object gets no feed section —
// there is no ActivityEntry.<slug>Id column to scope the query by.
const ACTIVITY_SCOPE_SLUG: Record<string, 'companyId' | 'personId' | 'dealId'> = {
  company: 'companyId',
  person: 'personId',
  deal: 'dealId',
}

interface RecordPeekDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  object: ObjectDef
  attributes: AttributeDef[]
  record: RecordRow | null
  timeZone: string | null | undefined
  /** 1-based position and total, for the breadcrumb ("3 of 128"). */
  position: { index: number; total: number } | null
  onEdit: (attribute: AttributeDef, value: unknown) => void
}

interface PeekEntry {
  object: ObjectDef
  attributes: AttributeDef[]
  record: RecordRow
  scrollTop: number
}

/**
 * The read-only record peek drawer (MAI-167, Slice S1). Opens over the grid via
 * `Space`/⤢, steps with `j`/`k` — see the keydown handling in RecordGrid, which
 * owns focus/selection and just hands this component the record to show.
 *
 * Fields share MAI-170's inline edit and optimistic persistence path. Related
 * records are fetched as a bounded projection, so the root grid stays resident
 * while the drawer walks Company → Person → Deal.
 */
export function RecordPeekDrawer({
  open,
  onOpenChange,
  orgId,
  object,
  attributes,
  record,
  timeZone,
  position,
  onEdit,
}: RecordPeekDrawerProps) {
  const rootEntry = useMemo<PeekEntry | null>(() => record ? { object, attributes, record, scrollTop: 0 } : null, [attributes, object, record])
  const [stack, setStack] = useState<PeekEntry[]>(() => rootEntry ? [rootEntry] : [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const restoreScrollTopRef = useRef<number | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!rootEntry) {
        setStack([])
        return
      }
      setStack((current) => current.length > 0
        && current[0].object.id === rootEntry.object.id
        && current[0].record.id === rootEntry.record.id
        ? [{ ...current[0], object: rootEntry.object, attributes: rootEntry.attributes, record: rootEntry.record }, ...current.slice(1)]
        : [rootEntry])
    })
    return () => cancelAnimationFrame(frame)
  }, [rootEntry])

  const active = stack.at(-1) ?? rootEntry
  const activeObject = active?.object ?? object
  const activeAttributes = active?.attributes ?? attributes
  const activeRecord = active?.record ?? record
  const identityAttr = activeAttributes.find((attr) => attr.isIdentity) ?? activeAttributes[0] ?? null
  const identityValue = identityAttr && activeRecord ? formatCellValue(activeRecord[identityAttr.slug], identityAttr.type, timeZone) : ''
  const title = identityValue || activeObject.name

  const scopeKey = ACTIVITY_SCOPE_SLUG[activeObject.slug]
  const scope: ActivityScope | null = scopeKey && activeRecord ? ({ [scopeKey]: activeRecord.id } as ActivityScope) : null
  const activityQuery = useGetActivity(orgId, scope)
  const relatedQuery = useGetRelatedRecords(orgId, activeObject.id, activeRecord?.id)
  const fieldButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const detailAttributes = activeAttributes
    .filter((attr) => attr.storage !== 'list' && !attr.isArchived && attr.slug !== identityAttr?.slug)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)

  useEffect(() => {
    if (restoreScrollTopRef.current === null) return
    const next = restoreScrollTopRef.current
    restoreScrollTopRef.current = null
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = next
    })
  }, [stack.length])

  function popTo(index: number) {
    if (index < 0 || index >= stack.length - 1) return
    restoreScrollTopRef.current = stack[index].scrollTop
    setStack((current) => current.slice(0, index + 1))
  }

  function openRelated(group: RelatedRecordGroup, nextRecord: RecordRow) {
    const nextObject = group.object
    const nextAttributes = nextObject.attributes ?? []
    restoreScrollTopRef.current = 0
    setStack((current) => [
      ...current.map((entry, index) => index === current.length - 1
        ? { ...entry, scrollTop: scrollRef.current?.scrollTop ?? entry.scrollTop }
        : entry),
      { object: nextObject, attributes: nextAttributes, record: nextRecord, scrollTop: 0 },
    ])
  }

  function handleEscape(event: KeyboardEvent) {
    if (stack.length <= 1) return
    event.preventDefault()
    popTo(stack.length - 2)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[540px]" onEscapeKeyDown={handleEscape}>
        <SheetHeader className="border-b border-border">
          {stack.length > 1 && <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit gap-1 px-2" onClick={() => popTo(stack.length - 2)}><ArrowLeft size={14} aria-hidden /> Back</Button>}
          <nav aria-label="Record path" className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
            {stack.map((entry, index) => {
              const entryIdentity = entry.attributes.find((attr) => attr.isIdentity) ?? entry.attributes[0]
              const entryTitle = entryIdentity ? formatCellValue(entry.record[entryIdentity.slug], entryIdentity.type, timeZone) || entry.object.name : entry.object.name
              return (
                <span key={`${entry.object.id}:${entry.record.id}`} className="flex shrink-0 items-center gap-1">
                  {index > 0 && <span aria-hidden>›</span>}
                  {index === stack.length - 1 ? <span className="font-medium text-foreground">{entryTitle}</span> : <button type="button" className="hover:text-foreground hover:underline" onClick={() => popTo(index)}>{entryTitle}</button>}
                </span>
              )
            })}
          </nav>
          <p className="text-xs text-muted-foreground">
            {activeObject.namePlural}
            {stack.length === 1 && position ? ` · ${position.index} of ${position.total}` : ''}
          </p>
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="sr-only">Record details. Click a field value to edit it.</SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-border p-4">
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">Details</h3>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-3 text-sm">
              {detailAttributes.map((attr, index) => {
                const nextEditable = detailAttributes.slice(index + 1).find((candidate) => !candidate.isReadOnly)
                return (
                  <FieldRow
                    key={attr.id}
                    orgId={orgId}
                    attr={attr}
                    record={activeRecord}
                    timeZone={timeZone}
                    canEdit={activeObject.id === object.id && activeRecord?.id === record?.id}
                    onEdit={(attribute, value) => onEdit(attribute, value)}
                    focusButtonRef={(button) => {
                      if (button) fieldButtonRefs.current.set(attr.id, button)
                      else fieldButtonRefs.current.delete(attr.id)
                    }}
                    onTabNext={nextEditable ? () => fieldButtonRefs.current.get(nextEditable.id)?.focus() : undefined}
                  />
                )
              })}
            </dl>
          </section>

          {activeRecord && <RecordNoteComposer orgId={orgId} object={activeObject} record={activeRecord} />}

          <section className="border-b border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Related</h3>
              {relatedQuery.data?.related.length ? <span className="text-xs text-muted-foreground">{relatedQuery.data.related.reduce((total, group) => total + group.count, 0)} records</span> : null}
            </div>
            {relatedQuery.isPending && <p className="text-sm text-muted-foreground">Loading related records…</p>}
            {relatedQuery.isError && <p className="text-sm text-destructive">Could not load related records.</p>}
            {!relatedQuery.isPending && !relatedQuery.isError && relatedQuery.data?.related.length === 0 && <p className="text-sm text-muted-foreground">No related records.</p>}
            <div className="space-y-3">
              {relatedQuery.data?.related.map((group) => (
                <RelatedRail key={group.id} group={group} timeZone={timeZone} onOpen={(nextRecord) => openRelated(group, nextRecord)} />
              ))}
            </div>
          </section>

          <section className="p-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Activity</h3>
            {!scope && <p className="text-sm text-muted-foreground">No activity feed for this object.</p>}
            {scope && activityQuery.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {scope && activityQuery.isError && (
              <p className="text-sm text-destructive">Could not load activity.</p>
            )}
            {scope && activityQuery.data && activityQuery.data.activity.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            {scope && activityQuery.data && activityQuery.data.activity.length > 0 && (
              <ul className="border border-border bg-bg">
                {activityQuery.data.activity.map((entry) => (
                  <li key={entry.id}><ActivityFeedRow item={mapActivityEntry(entry)} timeZone={timeZone} /></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

const RELATION_COLORS = ['option-3', 'option-1', 'option-6', 'option-4', 'option-7', 'option-2', 'option-5', 'option-8'] as const

function recordTitle(record: RecordRow, object: ObjectDef, timeZone: string | null | undefined): string {
  const identity = object.attributes?.find((attribute) => attribute.isIdentity) ?? object.attributes?.[0]
  return identity ? formatCellValue(record[identity.slug], identity.type, timeZone) || object.name : object.name
}

function RelatedRail({
  group,
  timeZone,
  onOpen,
}: {
  group: RelatedRecordGroup
  timeZone: string | null | undefined
  onOpen: (record: RecordRow) => void
}) {
  const objectColor = resolveOptionColor(RELATION_COLORS[group.object.slug.length % RELATION_COLORS.length])
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium">
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: objectColor }} />
        <span>{group.label}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{group.count}</span>
      </div>
      <div className="divide-y divide-border">
        {group.records.map((relatedRecord) => (
          <RelatedRecordRow key={relatedRecord.id} group={group} record={relatedRecord} timeZone={timeZone} onOpen={onOpen} />
        ))}
        {group.count > group.records.length && <p className="px-3 py-2 text-xs text-muted-foreground">Showing {group.records.length} of {group.count}.</p>}
      </div>
    </div>
  )
}

function RelatedRecordRow({
  group,
  record,
  timeZone,
  onOpen,
}: {
  group: RelatedRecordGroup
  record: RecordRow
  timeZone: string | null | undefined
  onOpen: (record: RecordRow) => void
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const title = recordTitle(record, group.object, timeZone)
  const previewAttribute = group.object.attributes?.find((attribute) => !attribute.isIdentity && attribute.storage !== 'list' && !attribute.isArchived)
  const previewValue = previewAttribute ? formatCellValue(record[previewAttribute.slug], previewAttribute.type, timeZone) : ''
  return (
    <div className="relative">
      <button
        type="button"
        className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
        aria-label={`Open ${title}`}
        onClick={() => onOpen(record)}
        onMouseEnter={() => setPreviewOpen(true)}
        onMouseLeave={() => setPreviewOpen(false)}
        onFocus={() => setPreviewOpen(true)}
        onBlur={() => setPreviewOpen(false)}
      >
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Open</span>
      </button>
      {previewOpen && (
        <div role="tooltip" className="pointer-events-none absolute right-2 bottom-full z-20 mb-1 w-56 rounded-md border border-border bg-background p-3 text-xs shadow-md">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-1 text-muted-foreground">{group.object.name}{previewValue ? ` · ${previewValue}` : ''}</p>
        </div>
      )}
    </div>
  )
}

function FieldRow({
  orgId,
  attr,
  record,
  timeZone,
  canEdit,
  onEdit,
  focusButtonRef,
  onTabNext,
}: {
  orgId: string
  attr: AttributeDef
  record: RecordRow | null
  timeZone: string | null | undefined
  canEdit: boolean
  onEdit: (attribute: AttributeDef, value: unknown) => void
  focusButtonRef: (button: HTMLButtonElement | null) => void
  onTabNext?: () => void
}) {
  const rawValue = record ? record[attr.slug] : null
  const [editing, setEditing] = useState(false)

  function commit(value: unknown) {
    setEditing(false)
    if (!attr.isReadOnly && JSON.stringify(value) !== JSON.stringify(rawValue)) onEdit(attr, value)
  }

  return (
    <>
      <dt className="truncate text-muted-foreground">{attr.name}</dt>
      <dd className="min-w-0 break-words text-foreground">
        {editing ? (
          <FieldValueEditor orgId={orgId} attribute={attr} value={rawValue} timeZone={timeZone} onCommit={commit} onCancel={() => setEditing(false)} onTabNext={onTabNext} />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={attr.isReadOnly || !canEdit}
            ref={focusButtonRef}
            className="w-full justify-start px-0 text-left disabled:cursor-default"
            onClick={() => setEditing(true)}
          >
            <FieldValue attr={attr} rawValue={rawValue} timeZone={timeZone} currencyCode={typeof record?.currency === 'string' ? record.currency : undefined} />
          </Button>
        )}
      </dd>
    </>
  )
}

function FieldValue({
  attr,
  rawValue,
  timeZone,
  currencyCode,
}: {
  attr: AttributeDef
  rawValue: unknown
  timeZone: string | null | undefined
  currencyCode: string | undefined
}) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return <span className="text-muted-foreground">—</span>
  }

  if (attr.type === 'select' || attr.type === 'status' || attr.type === 'multiselect') {
    const options = parseOptions(attr.optionsJson)
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    return (
      <div className="flex flex-wrap gap-1">
        {values.map((value) => {
          const option = options.find((o) => o.value === value)
          return (
            <OptionChip key={String(value)} label={option?.label ?? String(value)} color={option?.color} />
          )
        })}
      </div>
    )
  }

  return <span>{formatCellValue(rawValue, attr.type, timeZone, currencyCode, attr.slug === 'amountMinor', attr.formatJson)}</span>
}
