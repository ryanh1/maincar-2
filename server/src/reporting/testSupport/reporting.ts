export type GoldenDeal = {
  id: string
  orgId: string
  stage: string
  amountMinor: number
}

/**
 * Small, hand-checked data for reporting tests. P1 report tests should consume
 * these expected values rather than calculate their expectation using the same
 * query implementation they are testing.
 */
export const GOLDEN_DEALS_FIXTURE: {
  deals: readonly GoldenDeal[]
  expected: {
    amountMinorByStage: Record<string, number>
  }
} = {
  deals: [
    { id: 'deal-new-1', orgId: 'org-a', stage: 'new', amountMinor: 17_000 },
    { id: 'deal-new-2', orgId: 'org-a', stage: 'new', amountMinor: 25_000 },
    { id: 'deal-qualified-1', orgId: 'org-a', stage: 'qualified', amountMinor: 31_000 },
    { id: 'deal-won-1', orgId: 'org-a', stage: 'won', amountMinor: 9_000 },
  ],
  expected: {
    amountMinorByStage: {
      new: 42_000,
      qualified: 31_000,
      won: 9_000,
    },
  },
}

/** A deliberately simple reference implementation for fixture integrity tests. */
export function aggregateAmountMinorByStage(
  deals: readonly Pick<GoldenDeal, 'stage' | 'amountMinor'>[],
): Record<string, number> {
  return deals.reduce<Record<string, number>>((totals, deal) => {
    totals[deal.stage] = (totals[deal.stage] ?? 0) + deal.amountMinor
    return totals
  }, {})
}

export function assertDrillReconcilesToCell({
  cellAmountMinor,
  rows,
}: {
  cellAmountMinor: number
  rows: readonly { amountMinor: number }[]
}): void {
  const drilledTotal = rows.reduce((total, row) => total + row.amountMinor, 0)
  if (drilledTotal !== cellAmountMinor) {
    throw new Error(
      `Drill rows total ${drilledTotal}, but the aggregate cell is ${cellAmountMinor}`,
    )
  }
}

export function assertRowsBelongToOrg(
  rows: readonly { orgId: string }[],
  orgId: string,
): void {
  if (rows.some((row) => row.orgId !== orgId)) {
    throw new Error(`Report rows include data outside org ${orgId}`)
  }
}
