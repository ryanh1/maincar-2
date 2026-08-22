import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGetActivity, type ActivityScope } from '@/hooks/crm'
import { formatDateTime } from '@/lib/datetime'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
import { parseOptions } from './cellBuilder'
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
              {detailAttributes.map((attr) => (
                <FieldRow key={attr.id} attr={attr} record={record} timeZone={timeZone} onEdit={onEdit} />
              ))}
            </dl>
          </section>

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
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            )}
            {scope && activityQuery.isError && (
              <p className="text-sm text-destructive">Could not load activity.</p>
            )}
            {scope && activityQuery.data && activityQuery.data.activity.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            {scope && activityQuery.data && activityQuery.data.activity.length > 0 && (
              <ul className="flex flex-col gap-3">
                {activityQuery.data.activity.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p className="text-foreground">{entry.summary}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(entry.occurredAt, timeZone)}</p>
                  </li>
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
  attr,
  record,
  timeZone,
  onEdit,
}: {
  attr: AttributeDef
  record: RecordRow | null
  timeZone: string | null | undefined
  onEdit: (attribute: AttributeDef, value: unknown) => void
}) {
  const rawValue = record ? record[attr.slug] : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(rawValue == null ? '' : String(rawValue))

  function commit() {
    setEditing(false)
    if (!attr.isReadOnly && draft !== String(rawValue ?? '')) onEdit(attr, draft === '' ? null : draft)
  }

  return (
    <>
      <dt className="truncate text-muted-foreground">{attr.name}</dt>
      <dd className="min-w-0 break-words text-foreground">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            disabled={attr.isReadOnly}
            className="w-full text-left disabled:cursor-default"
            onClick={() => {
              setDraft(rawValue == null ? '' : String(rawValue))
              setEditing(true)
            }}
          >
            <FieldValue attr={attr} rawValue={rawValue} timeZone={timeZone} />
          </button>
        )}
      </dd>
    </>
  )
}

function FieldValue({
  attr,
  rawValue,
  timeZone,
}: {
  attr: AttributeDef
  rawValue: unknown
  timeZone: string | null | undefined
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
            <Badge key={String(value)} variant="secondary">
              {option?.label ?? String(value)}
            </Badge>
          )
        })}
      </div>
    )
  }

  return <span>{formatCellValue(rawValue, attr.type, timeZone)}</span>
}
