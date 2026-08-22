import { describe, expect, it } from 'vitest'

import { calculatePivotValue, comparisonColumns } from './pivotCalculations'

describe('calculatePivotValue', () => {
  it('returns an unavailable value instead of dividing by zero', () => {
    expect(calculatePivotValue({ transform: 'percentOfRow', value: 25n, rowTotal: 0n })).toBeNull()
  })

  it('calculates percent-of-grand-total without losing the minor-unit value', () => {
    expect(calculatePivotValue({ transform: 'percentOfGrandTotal', value: 25n, grandTotal: 100n })).toBe(0.25)
  })

  it('adds YoY delta and percent delta columns from the matching prior-year date', () => {
    expect(comparisonColumns([
      { key: '2025-06-01', value: 100n },
      { key: '2026-06-01', value: 125n },
    ], 'samePeriodLastYear')).toEqual([
      { key: '2025-06-01', delta: null, percentDelta: null },
      { key: '2026-06-01', delta: 25n, percentDelta: 0.25 },
    ])
  })
})
