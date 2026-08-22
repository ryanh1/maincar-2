interface RecordCountProps {
  filteredCount: number
  isFiltered: boolean
  totalCount: number
}

/**
 * The grid data plane owns the counts; this view-only component keeps the
 * toolbar wording consistent wherever a record grid is rendered.
 */
export function RecordCount({ filteredCount, isFiltered, totalCount }: RecordCountProps) {
  const label = isFiltered ? `${filteredCount} of ${totalCount}` : `${totalCount} records`

  return (
    <output aria-live="polite" aria-label="Record count" className="text-sm tabular-nums text-muted-foreground">
      {label}
    </output>
  )
}
