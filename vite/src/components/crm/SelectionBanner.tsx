import { Button } from '@/components/ui/button'

interface SelectionBannerProps {
  loadedCount: number
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
}

/** Offers an O(1) extension from rows currently loaded in the grid to the full filtered view. */
export function SelectionBanner({ loadedCount, totalCount, onSelectAll, onClear }: SelectionBannerProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-border bg-muted/50 px-3 py-2 text-sm" role="status">
      <span>All {loadedCount} on screen are selected.</span>
      <Button size="sm" variant="link" className="h-auto p-0" onClick={onSelectAll}>Select all {totalCount} in this view</Button>
      <span aria-hidden="true">·</span>
      <Button size="sm" variant="link" className="h-auto p-0" onClick={onClear}>Clear</Button>
    </div>
  )
}
