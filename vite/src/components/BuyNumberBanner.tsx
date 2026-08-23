import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/buttonVariants'
import { useGetNumbers } from '@/hooks/phoneNumbers'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

/**
 * A one-line prompt shown when the organization has no active caller ID: without
 * one, no outbound call can go out. The dialer renders this above the keypad in
 * the next slice, so it is self-contained — it reads its own org and numbers and
 * decides for itself whether to show anything.
 *
 * It renders nothing while the numbers load, on error, or once an active number
 * exists (CLAUDE.md → never ship a live-looking control that does nothing).
 */
export function BuyNumberBanner() {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const { data } = useGetNumbers(orgId)

  // No answer yet, or the org already has a caller ID: nothing to prompt.
  if (!data || data.activeCount > 0) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2">
      <p className="text-sm">You need a number to call out.</p>
      <Link to="/settings/numbers" className={cn(buttonVariants({ size: 'sm' }))}>
        Buy a number
      </Link>
    </div>
  )
}
