import { useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useBuyNumber, useSearchAvailableNumbers } from '@/hooks/phoneNumbers'
import type { AvailableNumber } from '@/hooks/phoneNumbers'
import { ApiError } from '@/lib/api'
import { formatMonthlyPrice } from '@/lib/phoneNumberLabels'

// Twilio sells local numbers in many countries; these are the ones a rep asks
// for. Area-code search is US/CA only (server-side), so the field says so.
const COUNTRIES: { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
]

interface BuyDialogProps {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Search Twilio for a number and buy one.
 *
 * Search is a live billable Twilio call, so results are never cached — the
 * mutation holds them for as long as the dialog is open. Buying queues a purchase
 * that spends money; the server answers with a `searching` row and invalidates
 * the list, so the new row appears on the pane the moment the dialog closes.
 *
 * Clicking "Buy" does not buy anything yet — it opens a confirm naming the
 * exact monthly charge, since nothing upstream of this dialog states that cost
 * before money moves.
 */
export function Settings_PhoneNumbers_BuyDialog({ orgId, open, onOpenChange }: BuyDialogProps) {
  const [country, setCountry] = useState('US')
  const [areaCode, setAreaCode] = useState('')
  const [contains, setContains] = useState('')
  const [confirmNumber, setConfirmNumber] = useState<AvailableNumber | null>(null)

  const search = useSearchAvailableNumbers()
  const buy = useBuyNumber()

  const results = search.data?.numbers ?? []
  const priceUnit = search.data?.priceUnit ?? 'USD'
  const areaCodeAllowed = country === 'US' || country === 'CA'

  function onSearch(event: FormEvent) {
    event.preventDefault()
    search.mutate({
      orgId,
      country,
      areaCode: areaCodeAllowed && areaCode.trim() ? areaCode.trim() : undefined,
      contains: contains.trim() ? contains.trim() : undefined,
    })
  }

  async function onBuy(e164: string) {
    try {
      await buy.mutateAsync({ orgId, e164 })
      setConfirmNumber(null)
      toast.success('Number added. It is provisioning now.')
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not buy that number. Try another one.',
      )
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buy a number</DialogTitle>
            <DialogDescription>Search for a number, then buy the one you want.</DialogDescription>
          </DialogHeader>

          <form onSubmit={onSearch} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buy-country">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="buy-country" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="buy-area-code">Area code</Label>
                <Input
                  id="buy-area-code"
                  className="h-8 tabular-nums"
                  inputMode="numeric"
                  placeholder="415"
                  value={areaCode}
                  disabled={!areaCodeAllowed}
                  onChange={(e) => setAreaCode(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="buy-contains">Contains</Label>
                <Input
                  id="buy-contains"
                  className="h-8"
                  placeholder="CALL or 1234"
                  value={contains}
                  onChange={(e) => setContains(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" className="self-start" disabled={search.isPending}>
              <Search size={16} aria-hidden />
              {search.isPending ? 'Searching…' : 'Search'}
            </Button>
          </form>

          <div className="max-h-72 overflow-y-auto">
            {search.isPending && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}

            {search.isError && !search.isPending && (
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <p className="text-sm text-destructive">
                  {search.error instanceof ApiError
                    ? search.error.message
                    : 'Could not search for numbers. Try again.'}
                </p>
              </div>
            )}

            {search.isSuccess && !search.isPending && results.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No numbers match. Try a different area code.
              </p>
            )}

            {results.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {results.map((number) => {
                  const buyingThis = buy.isPending && buy.variables?.e164 === number.e164
                  return (
                    <li
                      key={number.e164}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm tabular-nums">
                          {number.friendly || number.e164}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatMonthlyPrice(number.priceMonthly, priceUnit)}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={buy.isPending}
                        onClick={() => setConfirmNumber(number)}
                        aria-label={`Buy ${number.e164}`}
                      >
                        {buyingThis ? 'Buying…' : 'Buy'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmNumber !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmNumber(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buy {confirmNumber?.friendly || confirmNumber?.e164}?</AlertDialogTitle>
            <AlertDialogDescription>
              This charges {formatMonthlyPrice(confirmNumber?.priceMonthly ?? null, priceUnit)} to
              your organization, every month, until you release it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={buy.isPending}
              onClick={(event) => {
                // Hold the dialog open until the server answers, so a refused
                // purchase reports its reason instead of vanishing.
                event.preventDefault()
                if (confirmNumber) void onBuy(confirmNumber.e164)
              }}
            >
              {buy.isPending ? 'Buying…' : 'Buy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
