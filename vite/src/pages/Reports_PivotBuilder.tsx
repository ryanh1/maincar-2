import { type DragEvent, Fragment, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { isRunnablePivot } from '@/lib/reportConfig'
import type { DealPivotDimension, ReportConfig, RunReportResponse } from '@/lib/reportTypes'

type PivotZone = 'rows' | 'columns' | 'values'

const DIMENSIONS: Array<{ field: DealPivotDimension; label: string }> = [
  { field: 'owner', label: 'Owner' },
  { field: 'stage', label: 'Stage' },
]

const DIMENSION_LABELS: Record<DealPivotDimension, string> = { owner: 'Owner', stage: 'Stage' }
const MEASURE = { field: 'amountMinor', label: 'Amount' } as const

interface ReportsPivotBuilderProps {
  config: ReportConfig
  onChange: (config: ReportConfig) => void
  result: RunReportResponse['report'] | undefined
}

/** Excel-like pivot zones, with the result recomputed whenever a field moves. */
export function ReportsPivotBuilder({ config, onChange, result }: ReportsPivotBuilderProps) {
  function moveField(field: string, zone: PivotZone): void {
    if (zone === 'values') {
      if (field === MEASURE.field) onChange({ ...config, values: [{ field: 'amountMinor', aggregation: 'sum' }] })
      return
    }
    if (!DIMENSIONS.some((dimension) => dimension.field === field)) return

    const dimension = field as DealPivotDimension
    const withoutDimension = {
      ...config,
      rows: config.rows.filter((item) => item.field !== dimension),
      columns: config.columns.filter((item) => item.field !== dimension),
    }
    onChange({ ...withoutDimension, [zone]: [...withoutDimension[zone], { field: dimension }] })
  }

  function removeField(field: string, zone: PivotZone): void {
    if (zone === 'values') {
      onChange({ ...config, values: [] })
      return
    }
    const dimension = field as DealPivotDimension
    onChange({ ...config, [zone]: config[zone].filter((item) => item.field !== dimension) })
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, field: string): void {
    event.dataTransfer.setData('text/plain', field)
    event.dataTransfer.effectAllowed = 'move'
  }

  function dropField(event: DragEvent<HTMLElement>, zone: PivotZone): void {
    event.preventDefault()
    moveField(event.dataTransfer.getData('text/plain'), zone)
  }

  const isRunnable = isRunnablePivot(config)

  return (
    <div className="grid gap-6 xl:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" aria-label="Report fields">
        <div>
          <p className="text-xs font-medium text-text-muted">Data</p>
          <p className="text-sm font-medium">Deals</p>
        </div>
        <FieldGroup label="Dimensions">
          {DIMENSIONS.map((dimension) => <DraggableField key={dimension.field} {...dimension} onDragStart={startDrag} onClick={() => moveField(dimension.field, 'rows')} />)}
        </FieldGroup>
        <FieldGroup label="Measures">
          <DraggableField label={MEASURE.label} field={MEASURE.field} onDragStart={startDrag} onClick={() => moveField(MEASURE.field, 'values')} />
        </FieldGroup>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid gap-3 md:grid-cols-3" aria-label="Pivot drop zones">
          <DropZone label="Rows" zone="rows" items={config.rows.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
          <DropZone label="Columns" zone="columns" items={config.columns.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
          <DropZone label="Values" zone="values" items={config.values.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
        </div>
        {!isRunnable && <p className="text-sm text-text-muted">Drag a dimension to Rows or Columns, then drag Amount to Values.</p>}
        {isRunnable && <PivotGrid config={config} result={result} />}
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2"><p className="text-xs font-medium text-text-muted">{label}</p>{children}</div>
}

function DraggableField({ label, field, onDragStart, onClick }: {
  label: string
  field: string
  onDragStart: (event: DragEvent<HTMLButtonElement>, field: string) => void
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant="secondary" className="w-full justify-start" draggable onDragStart={(event) => onDragStart(event, field)} onClick={onClick}>
      {label}
    </Button>
  )
}

function DropZone({ label, zone, items, onDrop, onRemove }: {
  label: string
  zone: PivotZone
  items: string[]
  onDrop: (event: DragEvent<HTMLElement>, zone: PivotZone) => void
  onRemove: (field: string, zone: PivotZone) => void
}) {
  return (
    <section className="flex min-h-24 flex-col gap-2 rounded-md border border-border bg-bg p-3" aria-label={`${label} drop zone`} data-testid={`drop-zone-${zone}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, zone)}>
      <h3 className="text-sm font-semibold">{label}</h3>
      {items.length === 0 ? <p className="text-xs text-text-muted">Drag a field here</p> : items.map((field) => (
        <Button key={field} type="button" size="sm" variant="secondary" onClick={() => onRemove(field, zone)}>
          {field === MEASURE.field ? 'Amount' : DIMENSION_LABELS[field as DealPivotDimension]} ×
        </Button>
      ))}
    </section>
  )
}

interface PivotNode {
  key: string
  label: string
  values: Map<string, bigint>
  children: Map<string, PivotNode>
}

function newNode(key: string, label: string): PivotNode {
  return { key, label, values: new Map(), children: new Map() }
}

function addAmount(node: PivotNode, columnKey: string, amount: bigint): void {
  node.values.set(columnKey, (node.values.get(columnKey) ?? 0n) + amount)
}

function fieldValue(row: RunReportResponse['report']['rows'][number], field: DealPivotDimension, suffix: 'Id' | 'Name'): string {
  const key = `${field}${suffix}` as keyof typeof row
  return String(row[key] ?? (suffix === 'Name' ? 'Unassigned' : 'unassigned'))
}

function formatAmountMinor(amountMinor: bigint): string {
  const sign = amountMinor < 0n ? '-' : ''
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor
  const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(absolute / 100n)
  const cents = String(absolute % 100n).padStart(2, '0')
  return `${sign}$${dollars}.${cents}`
}

function PivotGrid({ config, result }: { config: ReportConfig; result: RunReportResponse['report'] | undefined }) {
  if (!result) return <div className="h-32 animate-pulse rounded-md bg-surface" aria-label="Loading pivot" />
  if (result.rows.length === 0) return <p className="text-sm text-text-muted">No Deals match this pivot.</p>

  const root = newNode('grand-total', 'Grand total')
  const columnHeaders = new Map<string, string>()
  const columnFields = config.columns.map((item) => item.field)
  const rowFields = config.rows.map((item) => item.field)

  for (const row of result.rows) {
    const columnKey = columnFields.length === 0 ? 'total' : columnFields.map((field) => fieldValue(row, field, 'Id')).join('\u0001')
    const columnLabel = columnFields.length === 0 ? 'Amount' : columnFields.map((field) => fieldValue(row, field, 'Name')).join(' · ')
    columnHeaders.set(columnKey, columnLabel)
    const amount = BigInt(row.amountMinor)
    addAmount(root, columnKey, amount)
    let parent = root
    for (const field of rowFields) {
      const key = `${parent.key}\u0001${fieldValue(row, field, 'Id')}`
      let child = parent.children.get(key)
      if (!child) {
        child = newNode(key, fieldValue(row, field, 'Name'))
        parent.children.set(key, child)
      }
      addAmount(child, columnKey, amount)
      parent = child
    }
  }

  const columns = [...columnHeaders.entries()]
  const showGrandTotalColumn = columnFields.length > 0
  const renderedRows = rowFields.length === 0 ? [] : [...root.children.values()].flatMap((node) => renderNode(node, 0, columns))

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full">
        <caption className="sr-only">Deals pivot</caption>
        <thead><tr className="border-b border-border bg-surface">
          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">{rowFields.map((field) => DIMENSION_LABELS[field]).join(' / ') || 'Total'}</th>
          {columns.map(([key, label]) => <th key={key} scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">{label}</th>)}
          {showGrandTotalColumn && <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">Grand total</th>}
        </tr></thead>
        <tbody>{renderedRows}{renderPivotRow(root, 0, columns, true, showGrandTotalColumn)}</tbody>
      </table>
    </div>
  )
}

function renderNode(node: PivotNode, level: number, columns: Array<[string, string]>): ReactNode[] {
  const showGrandTotalColumn = columns.some(([key]) => key !== 'total')
  return [<Fragment key={node.key}>{renderPivotRow(node, level, columns, false, showGrandTotalColumn)}</Fragment>, ...[...node.children.values()].flatMap((child) => renderNode(child, level + 1, columns))]
}

function renderPivotRow(node: PivotNode, level: number, columns: Array<[string, string]>, grandTotal = false, showGrandTotalColumn = false) {
  return (
    <tr key={`${node.key}-${grandTotal ? 'total' : 'row'}`} className="border-b border-border last:border-0">
      <th scope="row" className={`py-2 pr-3 text-left text-sm ${grandTotal || node.children.size > 0 ? 'font-medium' : 'font-normal'} ${level === 0 ? 'pl-3' : 'pl-6'}`}>{node.label}</th>
      {columns.map(([key]) => <td key={key} className="px-3 py-2 text-right text-sm tabular-nums">{formatAmountMinor(node.values.get(key) ?? 0n)}</td>)}
      {showGrandTotalColumn && <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">{formatAmountMinor([...node.values.values()].reduce((total, amount) => total + amount, 0n))}</td>}
    </tr>
  )
}
