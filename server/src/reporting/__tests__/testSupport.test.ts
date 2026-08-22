import { describe, expect, it } from 'vitest'

import {
  GOLDEN_DEALS_FIXTURE,
  assertDrillReconcilesToCell,
  assertRowsBelongToOrg,
  aggregateAmountMinorByStage,
} from '../testSupport/reporting.js'

describe('reporting golden fixture', () => {
  it('keeps its hand-checked stage totals separate from the reference aggregation', () => {
    expect(aggregateAmountMinorByStage(GOLDEN_DEALS_FIXTURE.deals)).toEqual(
      GOLDEN_DEALS_FIXTURE.expected.amountMinorByStage,
    )
  })

  it('proves drilled rows reconcile to their aggregate cell', () => {
    expect(() =>
      assertDrillReconcilesToCell({
        cellAmountMinor: 42_000,
        rows: [{ amountMinor: 17_000 }, { amountMinor: 25_000 }],
      }),
    ).not.toThrow()

    expect(() =>
      assertDrillReconcilesToCell({
        cellAmountMinor: 42_000,
        rows: [{ amountMinor: 17_000 }, { amountMinor: 24_999 }],
      }),
    ).toThrow('Drill rows total 41999, but the aggregate cell is 42000')
  })

  it('rejects a tenant leak from report rows', () => {
    expect(() =>
      assertRowsBelongToOrg(
        [
          { orgId: 'org-a' },
          { orgId: 'org-b' },
        ],
        'org-a',
      ),
    ).toThrow('Report rows include data outside org org-a')
  })
})
