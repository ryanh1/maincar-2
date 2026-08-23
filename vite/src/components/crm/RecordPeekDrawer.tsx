import { useRef, useState } from 'react'

import { ActivityFeedRow } from '@/components/activity-feed/ActivityFeedRow'
import { mapActivityEntry } from '@/components/activity-feed/activityFeed'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGetActivity, type ActivityScope } from '@/hooks/crm'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
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

/**
 * The read-only record peek drawer (MAI-167, Slice S1). Opens over the grid via
 * `Space`/⤢, steps with `j`/`k` — see the keydown handling in RecordGrid, which
 * owns focus/selection and just hands this component the record to show.
 *
 * Fields share MAI-170's inline edit and optimistic persistence path. Related rails and the full
 * breadcrumb stack (peek-over-peek navigation) are scaffolded, not wired —
 * that's MAI-184, blocked on the Chunk 4 deep spec landing on main.
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
  const identityAttr = attributes.find((attr) => attr.isIdentity) ?? attributes[0] ?? null
  const identityValue = identityAttr && record ? formatCellValue(record[identityAttr.slug], identityAttr.type, timeZone) : ''
  const title = identityValue || object.name

  const scopeKey = ACTIVITY_SCOPE_SLUG[object.slug]
  const scope: ActivityScope | null = scopeKey && record ? ({ [scopeKey]: record.id } as ActivityScope) : null
  const activityQuery = useGetActivity(orgId, scope)
  const fieldButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  const detailAttributes = attributes
    .filter((attr) => attr.storage !== 'list' && !attr.isArchived && attr.slug !== identityAttr?.slug)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[540px]">
        <SheetHeader className="border-b border-border">
          <p className="text-xs text-muted-foreground">
            {object.namePlural}
            {position ? ` · ${position.index} of ${position.total}` : ''}
          </p>
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="sr-only">Record details. Click a field value to edit it.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
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
                    record={record}
                    timeZone={timeZone}
                    onEdit={onEdit}
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

          {record && <RecordNoteComposer orgId={orgId} object={object} record={record} />}

          <section className="border-b border-border p-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Related</h3>
            <p className="text-sm text-muted-foreground">
              Related-record rails are coming in a later slice (MAI-184).
            </p>
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

function FieldRow({
  orgId,
  attr,
  record,
  timeZone,
  onEdit,
  focusButtonRef,
  onTabNext,
}: {
  orgId: string
  attr: AttributeDef
  record: RecordRow | null
  timeZone: string | null | undefined
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
            disabled={attr.isReadOnly}
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
