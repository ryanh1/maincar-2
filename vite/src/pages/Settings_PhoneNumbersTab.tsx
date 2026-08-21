import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetNumbers } from '@/hooks/phoneNumbers'
import { useAuth } from '@/providers/useAuth'

import { Settings_PhoneNumbers_BuyDialog } from './Settings_PhoneNumbers_BuyDialog'
import { Settings_PhoneNumbers_OrgTable } from './Settings_PhoneNumbers_OrgTable'
import { Settings_PhoneNumbers_Row } from './Settings_PhoneNumbers_Row'

/**
 * Settings → Phone numbers: the numbers this organization owns, and the caller ID
 * every outbound call goes out on.
 *
 * Picking the caller ID is a radio, not a checkbox: choosing one un-picks the
 * rest, so the control is disabled on the number that is already active and on any
 * number that is not yet dialable (a `searching` row is still provisioning). The
 * server re-checks all of it — every disabled control here is a courtesy.
 *
 * Each row also carries the one action that stops the org paying for a number:
 * releasing it. That lives in Settings_PhoneNumbers_Row, behind a confirm.
 */
export function Settings_PhoneNumbersTab() {
  const { org, isAdmin } = useAuth()
  const orgId = org?.id ?? null

  const numbersQuery = useGetNumbers(orgId)

  const [buyOpen, setBuyOpen] = useState(false)

  if (!org || !orgId) return null

  const data = numbersQuery.data
  const numbers = data?.numbers ?? []

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Phone numbers</h2>
        {numbers.length > 0 && (
          <Button size="sm" onClick={() => setBuyOpen(true)}>
            Buy a number
          </Button>
        )}
      </div>

      {numbersQuery.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {numbersQuery.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">Could not load your numbers.</p>
          <Button variant="secondary" size="sm" onClick={() => void numbersQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {data && numbers.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border py-12 text-center">
          <p className="text-base font-semibold">You need a number to call out.</p>
          <Button size="sm" onClick={() => setBuyOpen(true)}>
            Buy a number
          </Button>
        </div>
      )}

      {data && numbers.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <caption className="sr-only">Phone numbers owned by {org.name}</caption>
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Number
                </th>
                <th scope="col" className="w-40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th scope="col" className="w-48 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Caller ID
                </th>
                <th scope="col" className="w-12 px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody role="radiogroup" aria-label="Outbound caller ID">
              {numbers.map((number) => (
                <Settings_PhoneNumbers_Row
                  key={number.id}
                  number={number}
                  orgId={orgId}
                  // Counted here rather than in the row, because it is a fact
                  // about the whole list: whether releasing THIS number would
                  // leave the rep with a caller ID to fall back on.
                  hasOtherActiveNumber={numbers.some(
                    (other) => other.id !== number.id && other.status === 'active',
                  )}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Settings_PhoneNumbers_BuyDialog orgId={orgId} open={buyOpen} onOpenChange={setBuyOpen} />

      {isAdmin && <Settings_PhoneNumbers_OrgTable orgId={orgId} />}
    </section>
  )
}
