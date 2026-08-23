import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useGetFieldHistory } from '@/hooks/crm'
import type { AttributeDef, FieldChange } from '@/lib/crmTypes'
import { formatCellValue } from './recordCellValue'

export interface ChangeHighlightTarget {
  recordId: string
  attribute: AttributeDef
  change: FieldChange
  bounds: { x: number; y: number; width: number; height: number }
}

interface ChangeHighlightOverlayProps {
  hover: ChangeHighlightTarget | null
  timeZone: string | null | undefined
  onShowFullHistory: (target: ChangeHighlightTarget) => void
}

/** HTML hover detail for a canvas cell, including the handoff to full history. */
export function ChangeHighlightOverlay({ hover, timeZone, onShowFullHistory }: ChangeHighlightOverlayProps) {
  if (!hover) return null
  const { attribute, change, bounds } = hover
  const previous = formatCellValue(change.previousValue, attribute.type, timeZone)
  const current = formatCellValue(change.currentValue, attribute.type, timeZone)

  return (
    <aside
      aria-label={`${attribute.name} change details`}
      className="absolute z-30 w-72 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
      style={{ left: bounds.x + 8, top: bounds.y + bounds.height + 4 }}
    >
      <p className="font-medium">{attribute.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{change.changeCount} {change.changeCount === 1 ? 'change' : 'changes'}</p>
      <p className="mt-2 break-words">{previous || '—'} → {current || '—'}</p>
      <Button type="button" variant="link" size="sm" className="mt-2 h-auto px-0" onClick={() => onShowFullHistory(hover)}>
        See full history
      </Button>
    </aside>
  )
}

export function FieldHistoryPopover({
  orgId,
  target,
  timeZone,
  onClose,
}: {
  orgId: string
  target: ChangeHighlightTarget
  timeZone: string | null | undefined
  onClose: () => void
}) {
  const historyQuery = useGetFieldHistory(orgId, target.recordId, target.attribute.slug)
  const entries = historyQuery.data?.pages.flatMap((page) => page.history) ?? []

  const { bounds, attribute } = target
  return (
    <section
      aria-label={`${attribute.name} full history`}
      className="absolute z-40 w-80 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
      style={{ left: bounds.x + 8, top: bounds.y + bounds.height + 4 }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{attribute.name} history</h2>
        <IconButton type="button" variant="ghost" size="icon-sm" onClick={onClose} tooltip="Close field history">
          <X size={16} />
        </IconButton>
      </div>
      {historyQuery.isPending && <p className="mt-3 text-muted-foreground">Loading…</p>}
      {historyQuery.isError && <p className="mt-3 text-destructive">Could not load field history.</p>}
      {!historyQuery.isPending && !historyQuery.isError && entries.length === 0 && <p className="mt-3 text-muted-foreground">No field history yet.</p>}
      {entries.length > 0 && (
        <ol className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
              {formatCellValue(entry.oldValue, attribute.type, timeZone) || '—'} → {formatCellValue(entry.newValue, attribute.type, timeZone) || '—'}
            </li>
          ))}
        </ol>
      )}
      {historyQuery.hasNextPage && (
        <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()}>
          Load more
        </Button>
      )}
    </section>
  )
}
