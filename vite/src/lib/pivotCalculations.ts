export type PivotValueTransform =
  | 'none'
  | 'percentOfGrandTotal'
  | 'percentOfColumn'
  | 'percentOfRow'
  | 'percentOfParent'
  | 'runningTotal'
  | 'rankLargestToSmallest'

export interface PivotValueInput {
  transform: PivotValueTransform
  value: bigint
  grandTotal?: bigint
  columnTotal?: bigint
  rowTotal?: bigint
  parentTotal?: bigint
  runningTotal?: bigint
  rank?: number
}

/** Returns null for an unavailable ratio so the grid can render an em dash. */
export function calculatePivotValue(input: PivotValueInput): bigint | number | null {
  switch (input.transform) {
    case 'none': return input.value
    case 'percentOfGrandTotal': return ratio(input.value, input.grandTotal)
    case 'percentOfColumn': return ratio(input.value, input.columnTotal)
    case 'percentOfRow': return ratio(input.value, input.rowTotal)
    case 'percentOfParent': return ratio(input.value, input.parentTotal)
    case 'runningTotal': return input.runningTotal ?? input.value
    case 'rankLargestToSmallest': return input.rank ?? null
  }
}

function ratio(value: bigint, denominator: bigint | undefined): number | null {
  return denominator === undefined || denominator === 0n ? null : Number(value) / Number(denominator)
}

export type PeriodComparison = 'previousPeriod' | 'samePeriodLastYear'

export interface ComparisonColumn {
  key: string
  delta: bigint | null
  percentDelta: number | null
}

/** Computes display-only period comparisons from sorted ISO date column keys. */
export function comparisonColumns(
  values: Array<{ key: string; value: bigint }>,
  mode: PeriodComparison,
): ComparisonColumn[] {
  const byKey = new Map(values.map((value) => [value.key, value.value]))
  return values.map((current, index) => {
    const previousKey = mode === 'previousPeriod'
      ? values[index - 1]?.key
      : sameDateLastYear(current.key)
    const previous = previousKey ? byKey.get(previousKey) : undefined
    if (previous === undefined) return { key: current.key, delta: null, percentDelta: null }
    const delta = current.value - previous
    return { key: current.key, delta, percentDelta: previous === 0n ? null : Number(delta) / Number(previous) }
  })
}

function sameDateLastYear(key: string): string | undefined {
  const match = /^(\d{4})(-.+)$/.exec(key)
  if (!match) return undefined
  return `${String(Number(match[1]) - 1).padStart(4, '0')}${match[2]}`
}
