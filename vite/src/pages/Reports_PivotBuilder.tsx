import { type DragEvent, Fragment, type ReactNode } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isRunnablePivot } from '@/lib/reportConfig'
import { calculatePivotValue, comparisonColumns, type PivotValueTransform } from '@/lib/pivotCalculations'
import type { DealPivotDimension, PeriodComparison, ReportConfig, RunReportResponse } from '@/lib/reportTypes'

type PivotZone = 'rows' | 'columns' | 'values'

const DIMENSIONS: Array<{ field: DealPivotDimension; label: string }> = [
  { field: 'owner', label: 'Owner' },
  { field: 'stage', label: 'Stage' },
  { field: 'createdAt', label: 'Created date' },
]

const DIMENSION_LABELS: Record<DealPivotDimension, string> = { owner: 'Owner', stage: 'Stage', createdAt: 'Created date' }
const MEASURE = { field: 'amountMinor', label: 'Amount' } as const

interface ReportsPivotBuilderProps {
  config: ReportConfig
  onChange: (config: ReportConfig) => void
  result: RunReportResponse['report'] | undefined
  isLoading: boolean
  hasActiveFilters: boolean
  onLoosenFilters: () => void
}

/** Excel-like pivot zones, with the result recomputed whenever a field moves. */
export function ReportsPivotBuilder({ config, onChange, result, isLoading, hasActiveFilters, onLoosenFilters }: ReportsPivotBuilderProps) {
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
    onChange({ ...withoutDimension, [zone]: [...withoutDimension[zone], { field: dimension }], ...(dimension === 'createdAt' ? { timeBucket: { field: 'createdAt', grain: 'day' } } : {}) })
  }

  function removeField(field: string, zone: PivotZone): void {
    if (zone === 'values') {
      onChange({ ...config, values: [] })
      return
    }
    const dimension = field as DealPivotDimension
    const next = { ...config, [zone]: config[zone].filter((item) => item.field !== dimension) }
    onChange(dimension === 'createdAt' ? { ...next, timeBucket: undefined, compareTo: undefined } : next)
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
  const isBlank = config.rows.length === 0 && config.columns.length === 0 && config.values.length === 0

  return (
    <div className="grid gap-6 xl:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" aria-label="Report fields">
        <div>
          <p className="text-xs font-medium text-text-muted">Data</p>
          <p className="text-sm font-medium">Deals</p>
        </div>
        <FieldGroup label={isBlank ? 'Suggested starter fields' : 'Dimensions'}>
          {DIMENSIONS.map((dimension) => <DraggableField key={dimension.field} {...dimension} onDragStart={startDrag} onClick={() => moveField(dimension.field, 'rows')} />)}
          {isBlank && <DraggableField label={MEASURE.label} field={MEASURE.field} onDragStart={startDrag} onClick={() => moveField(MEASURE.field, 'values')} />}
        </FieldGroup>
        {!isBlank && <FieldGroup label="Measures">
          <DraggableField label={MEASURE.label} field={MEASURE.field} onDragStart={startDrag} onClick={() => moveField(MEASURE.field, 'values')} />
        </FieldGroup>}
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid gap-3 md:grid-cols-3" aria-label="Pivot drop zones">
          <DropZone label="Rows" zone="rows" items={config.rows.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
          <DropZone label="Columns" zone="columns" items={config.columns.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
          <DropZone label="Values" zone="values" items={config.values.map((item) => item.field)} onDrop={dropField} onRemove={removeField} />
        </div>
        {config.values.length > 0 && <PivotControls config={config} onChange={onChange} />}
        {!isRunnable && <BuilderGuidance config={config} onAddOwner={() => moveField('owner', 'rows')} onAddAmount={() => moveField(MEASURE.field, 'values')} />}
        {isRunnable && <PivotGrid config={config} onChange={onChange} result={result} isLoading={isLoading} hasActiveFilters={hasActiveFilters} onLoosenFilters={onLoosenFilters} />}
      </div>
    </div>
  )
}

function PivotControls({ config, onChange }: Pick<ReportsPivotBuilderProps, 'config' | 'onChange'>) {
  const showAs = config.values[0]?.showAs ?? 'none'
  const hasDate = [...config.rows, ...config.columns].some((item) => item.field === 'createdAt')
  return <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
    <span className="text-sm font-medium">Show values as</span>
    <Select value={showAs} onValueChange={(value) => onChange({ ...config, values: [{ field: 'amountMinor', aggregation: 'sum', showAs: value as PivotValueTransform }] })}>
      <SelectTrigger size="sm" aria-label="Show values as"><SelectValue /></SelectTrigger>
      <SelectContent>{[
        ['none', 'No calculation'], ['percentOfGrandTotal', '% of grand total'], ['percentOfColumn', '% of column total'], ['percentOfRow', '% of row total'], ['percentOfParent', '% of parent'], ['runningTotal', 'Running total'], ['rankLargestToSmallest', 'Rank, largest to smallest'],
      ].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
    </Select>
    <span className="text-sm font-medium">Compare to</span>
    <Select value={config.compareTo ?? 'none'} disabled={!hasDate} onValueChange={(value) => onChange({ ...config, compareTo: value === 'none' ? undefined : value as PeriodComparison })}>
      <SelectTrigger size="sm" aria-label="Compare to"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="none">No comparison</SelectItem><SelectItem value="previousPeriod">Previous period</SelectItem><SelectItem value="samePeriodLastYear">Same period last year</SelectItem></SelectContent>
    </Select>
    {!hasDate && <span className="text-xs text-text-muted">Add Created date to compare periods.</span>}
  </div>
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
  const placeholder = zone === 'rows'
    ? 'Drag a field here to group rows.'
    : zone === 'columns'
      ? 'Drag a field here to compare columns.'
      : 'Drag Amount here to calculate a value.'

  return (
    <section className="flex min-h-24 flex-col gap-2 rounded-md border border-border bg-bg p-3" aria-label={`${label} drop zone`} data-testid={`drop-zone-${zone}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, zone)}>
      <h3 className="text-sm font-semibold">{label}</h3>
      {items.length === 0 ? <p className="text-xs text-text-muted">{placeholder}</p> : items.map((field) => (
        <Button key={field} type="button" size="sm" variant="secondary" onClick={() => onRemove(field, zone)}>
          {field === MEASURE.field ? 'Amount' : DIMENSION_LABELS[field as DealPivotDimension]} ×
        </Button>
      ))}
    </section>
  )
}

function BuilderGuidance({ config, onAddOwner, onAddAmount }: {
  config: ReportConfig
  onAddOwner: () => void
  onAddAmount: () => void
}) {
  const hasGroup = config.rows.length + config.columns.length > 0

  if (!hasGroup && config.values.length > 0) {
    return (
      <EmptyState title="Add a group">
        <p>Add a Row or Column to break Amount down.</p>
        <Button size="sm" onClick={onAddOwner}>Add Owner to Rows</Button>
      </EmptyState>
    )
  }

  if (hasGroup) {
    return (
      <EmptyState title="Add a value">
        <p>Add Amount to Values to calculate a result.</p>
        <Button size="sm" onClick={onAddAmount}>Add Amount to Values</Button>
      </EmptyState>
    )
  }

  return (
    <EmptyState title="Build a report in 3 steps">
      <ol className="flex flex-col gap-1">
        <li>1 Pick data: Deals</li>
        <li>2 Drag a field to Rows</li>
        <li>3 Drag Amount to Values</li>
      </ol>
    </EmptyState>
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
  if (field === 'createdAt') return row.createdDay ?? 'Unknown date'
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

function PivotGrid({ config, onChange, result, isLoading, hasActiveFilters, onLoosenFilters }: {
  config: ReportConfig
  onChange: (config: ReportConfig) => void
  result: RunReportResponse['report'] | undefined
  isLoading: boolean
  hasActiveFilters: boolean
  onLoosenFilters: () => void
}) {
  if (isLoading || !result) {
    return (
      <div className="flex h-32 flex-col justify-center gap-3 rounded-md border border-border bg-surface p-6" aria-busy="true">
        <p className="text-sm font-medium">Preparing this report…</p>
        <div className="h-8 animate-pulse rounded-md bg-surface-2" />
      </div>
    )
  }
  if (result.rows.length === 0) {
    return (
      <EmptyState title={hasActiveFilters ? 'No records match these filters.' : 'No records match this pivot.'}>
        <p>{hasActiveFilters ? 'Remove a filter to see more records.' : 'Change a field or filter to see records.'}</p>
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-text-muted">Owner&apos;s team filter</span>
            <Button size="sm" variant="secondary" onClick={onLoosenFilters}>Loosen filters</Button>
          </div>
        )}
      </EmptyState>
    )
  }

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
  const renderedRows = rowFields.length === 0 ? [] : [...root.children.values()].flatMap((node) => renderNode(node, 0, columns, root, undefined, config, onChange))

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full">
        <caption className="sr-only">Deals pivot</caption>
        <thead><tr className="border-b border-border bg-surface">
          <th scope="col" aria-label="Summary rows" className="w-8 px-2 py-2 text-left text-xs font-medium text-text-muted" />
          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">{rowFields.map((field) => DIMENSION_LABELS[field]).join(' / ') || 'Total'}</th>
          {columns.flatMap(([key, label]) => config.compareTo ? [<th key={key} scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">{label}</th>, <th key={`${key}-delta`} scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">Δ</th>, <th key={`${key}-percent`} scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">Δ %</th>] : [<th key={key} scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">{label}</th>])}
          {showGrandTotalColumn && <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">Grand total</th>}
        </tr></thead>
        <tbody>{renderedRows}{renderPivotRow(root, 0, columns, root, undefined, config, onChange, true, showGrandTotalColumn)}</tbody>
      </table>
    </div>
  )
}

function renderNode(node: PivotNode, level: number, columns: Array<[string, string]>, root: PivotNode, parent: PivotNode | undefined, config: ReportConfig, onChange: (config: ReportConfig) => void): ReactNode[] {
  const showGrandTotalColumn = columns.some(([key]) => key !== 'total')
  const summary = config.summaryRows?.find((row) => row.rowKey === node.key)
  return [<Fragment key={node.key}>{renderPivotRow(node, level, columns, root, parent, config, onChange, false, showGrandTotalColumn)}</Fragment>, ...(summary ? [renderSummaryRow(node, columns, root, config, summary.showAs)] : []), ...[...node.children.values()].flatMap((child) => renderNode(child, level + 1, columns, root, node, config, onChange))]
}

function renderSummaryRow(node: PivotNode, columns: Array<[string, string]>, root: PivotNode, config: ReportConfig, showAs: NonNullable<ReportConfig['summaryRows']>[number]['showAs']) {
  const grandTotal = [...root.values.values()].reduce((sum, value) => sum + value, 0n)
  const total = [...node.values.values()].reduce((sum, value) => sum + value, 0n)
  return <tr key={`${node.key}-summary`} className="border-b border-border bg-surface-2">
    <td className="px-2 py-2" /><th scope="row" className="py-2 pr-3 pl-6 text-left text-sm font-medium">{showAs === 'samePeriodLastYear' ? `${node.label} YoY %` : `${node.label} % of grand total`}</th>
    {columns.flatMap(([key], index) => {
      const value = node.values.get(key) ?? 0n
      const comparison = showAs === 'samePeriodLastYear' ? comparisonColumns(columns.map(([column]) => ({ key: column, value: node.values.get(column) ?? 0n })), 'samePeriodLastYear')[index]?.percentDelta ?? null : calculatePivotValue({ transform: 'percentOfGrandTotal', value, grandTotal })
      const text = comparison === null ? '—' : new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(comparison)
      return config.compareTo ? [<td key={key} className="px-3 py-2 text-right text-sm tabular-nums">{text}</td>, <td key={`${key}-delta`} className="px-3 py-2 text-right text-sm tabular-nums">—</td>, <td key={`${key}-percent`} className="px-3 py-2 text-right text-sm tabular-nums">—</td>] : [<td key={key} className="px-3 py-2 text-right text-sm tabular-nums">{text}</td>]
    })}
    {columns.some(([key]) => key !== 'total') && <td className="px-3 py-2 text-right text-sm tabular-nums">{showAs === 'samePeriodLastYear' ? '—' : new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(calculatePivotValue({ transform: 'percentOfGrandTotal', value: total, grandTotal }) ?? 0)}</td>}
  </tr>
}

function renderPivotRow(node: PivotNode, level: number, columns: Array<[string, string]>, root: PivotNode, parent: PivotNode | undefined, config: ReportConfig, onChange: (config: ReportConfig) => void, grandTotal = false, showGrandTotalColumn = false) {
  const transform = config.values[0]?.showAs ?? 'none'
  const total = [...node.values.values()].reduce((sum, value) => sum + value, 0n)
  const grandTotalAmount = [...root.values.values()].reduce((sum, value) => sum + value, 0n)
  const selected = config.summaryRows?.some((row) => row.rowKey === node.key) ?? false
  const comparisons = config.compareTo ? new Map(comparisonColumns(columns.map(([key]) => ({ key, value: node.values.get(key) ?? 0n })), config.compareTo).map((value) => [value.key, value])) : undefined
  function toggleSummary(checked: boolean) {
    const current = config.summaryRows ?? []
    onChange({ ...config, summaryRows: checked ? [...current, { rowKey: node.key, showAs: 'percentOfGrandTotal' }] : current.filter((row) => row.rowKey !== node.key) })
  }
  return (
    <tr key={`${node.key}-${grandTotal ? 'total' : 'row'}`} className="border-b border-border last:border-0">
      <td className="px-2 py-2">{!grandTotal && <Checkbox aria-label={`Add summary row under ${node.label}`} checked={selected} onCheckedChange={(checked) => toggleSummary(checked === true)} />}</td>
      <th scope="row" className={`py-2 pr-3 text-left text-sm ${grandTotal || node.children.size > 0 ? 'font-medium' : 'font-normal'} ${level === 0 ? 'pl-3' : 'pl-6'}`}>{node.label}</th>
      {columns.flatMap(([key], index) => {
        const value = node.values.get(key) ?? 0n
        const rank = [...node.values.values()].filter((candidate) => candidate > value).length + 1
        const runningTotal = columns.slice(0, index + 1).reduce((sum, [column]) => sum + (node.values.get(column) ?? 0n), 0n)
        const displayed = calculatePivotValue({ transform, value, rowTotal: total, columnTotal: root.values.get(key), parentTotal: parent?.values.get(key), grandTotal: grandTotalAmount, rank, runningTotal })
        const text = displayed === null ? '—' : typeof displayed === 'number' ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(displayed) : formatAmountMinor(displayed)
        const comparison = comparisons?.get(key)
        return config.compareTo ? [<td key={key} className="px-3 py-2 text-right text-sm tabular-nums">{text}</td>, <td key={`${key}-delta`} className="px-3 py-2 text-right text-sm tabular-nums">{comparison?.delta === null || !comparison ? '—' : formatAmountMinor(comparison.delta)}</td>, <td key={`${key}-percent`} className="px-3 py-2 text-right text-sm tabular-nums">{comparison?.percentDelta === null || !comparison ? '—' : new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(comparison.percentDelta)}</td>] : [<td key={key} className="px-3 py-2 text-right text-sm tabular-nums">{text}</td>]
      })}
      {showGrandTotalColumn && <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">{formatAmountMinor([...node.values.values()].reduce((total, amount) => total + amount, 0n))}</td>}
    </tr>
  )
}
