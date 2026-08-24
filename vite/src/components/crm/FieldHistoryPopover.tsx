import { useState } from 'react'
import { Clock3 } from 'lucide-react'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGetFieldHistory } from '@/hooks/crm'
import type { AttributeDef, FieldHistoryEntry } from '@/lib/crmTypes'
import { formatDateTime, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { parseOptions } from './cellBuilder'
import { OptionChip } from './OptionChip'
import { formatCellValue } from './recordCellValue'

interface FieldHistoryPopoverProps {
  orgId: string
  recordId: string
  attribute: AttributeDef
  timeZone: string | null | undefined
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchor?: { x: number; y: number; width: number; height: number }
  triggerClassName?: string
}

/** One field's paginated audit trail, reusable from DOM fields and canvas anchors. */
export function FieldHistoryPopover({
  orgId,
  recordId,
  attribute,
  timeZone,
  open,
  onOpenChange,
  anchor,
  triggerClassName,
}: FieldHistoryPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const historyQuery = useGetFieldHistory(orgId, isOpen ? recordId : null, isOpen ? attribute.slug : null)
  const entries = historyQuery.data?.pages.flatMap((page) => page.history) ?? []

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {anchor ? (
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute size-1"
            style={{ left: anchor.x + 8, top: anchor.y + anchor.height + 4 }}
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <IconButton
            type="button"
            tooltip={`Show ${attribute.name} history`}
            className={cn(
              'shrink-0 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100',
              triggerClassName,
            )}
          >
            <Clock3 size={16} aria-hidden />
          </IconButton>
        </PopoverTrigger>
      )}

      <PopoverContent align={anchor ? 'start' : 'end'} className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{attribute.name} history</h2>
        </div>

        {historyQuery.isPending && (
          <p role="status" className="p-3 text-sm text-text-muted">Loading field history…</p>
        )}
        {historyQuery.isError && (
          <div className="p-3">
            <p className="text-sm text-danger">Could not load field history.</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void historyQuery.refetch()}>
              Reload history
            </Button>
          </div>
        )}
        {!historyQuery.isPending && !historyQuery.isError && entries.length === 0 && (
          <p className="p-3 text-sm text-text-muted">No field history yet.</p>
        )}
        {entries.length > 0 && (
          <ol className="max-h-64 overflow-y-auto">
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} attribute={attribute} timeZone={timeZone} />
            ))}
          </ol>
        )}
        {historyQuery.hasNextPage && (
          <div className="border-t border-border p-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function HistoryRow({
  entry,
  attribute,
  timeZone,
}: {
  entry: FieldHistoryEntry
  attribute: AttributeDef
  timeZone: string | null | undefined
}) {
  const actorName = entry.actor?.name ?? (entry.changedByUserId ? 'Former member' : 'System')

  return (
    <li className="border-b border-border p-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={actorName} src={entry.actor?.avatarUrl} />
        <span className="min-w-0 truncate text-xs font-medium text-text">{actorName}</span>
        <time
          dateTime={entry.changedAt}
          title={formatDateTime(entry.changedAt, timeZone)}
          className="ml-auto shrink-0 text-xs tabular-nums text-text-muted"
        >
          {formatRelativeTime(entry.changedAt)}
        </time>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-sm">
        <HistoryValue value={entry.oldValue} attribute={attribute} timeZone={timeZone} muted />
        <span aria-hidden className="shrink-0 text-text-muted"> → </span>
        <HistoryValue value={entry.newValue} attribute={attribute} timeZone={timeZone} />
      </div>
    </li>
  )
}

function HistoryValue({
  value,
  attribute,
  timeZone,
  muted = false,
}: {
  value: unknown
  attribute: AttributeDef
  timeZone: string | null | undefined
  muted?: boolean
}) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <span className="shrink-0 text-text-muted">—</span>
  }

  if (attribute.type === 'select' || attribute.type === 'status' || attribute.type === 'multiselect') {
    const options = parseOptions(attribute.optionsJson)
    const values = Array.isArray(value) ? value : [value]
    return (
      <span className={cn('flex min-w-0 flex-wrap gap-1', muted && 'opacity-70')}>
        {values.map((item) => {
          const option = options.find((candidate) => candidate.value === item)
          return <OptionChip key={String(item)} label={option?.label ?? String(item)} color={option?.color} />
        })}
      </span>
    )
  }

  return (
    <span className={cn('min-w-0 break-words', muted && 'text-text-muted')}>
      {formatCellValue(value, attribute.type, timeZone, undefined, false, attribute.formatJson) || '—'}
    </span>
  )
}
