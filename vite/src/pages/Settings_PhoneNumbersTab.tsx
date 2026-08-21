import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetNumbers, useSetActiveNumber } from '@/hooks/phoneNumbers'
import type { PhoneNumber } from '@/hooks/phoneNumbers'
import { ApiError } from '@/lib/api'
import { getPhoneNumberStatusLabel } from '@/lib/phoneNumberLabels'
import { useAuth } from '@/providers/useAuth'

import { Settings_PhoneNumbers_BuyDialog } from './Settings_PhoneNumbers_BuyDialog'
import { Settings_PhoneNumbers_OrgTable } from './Settings_PhoneNumbers_OrgTable'

/**
 * Settings → Phone numbers: the numbers this organization owns, and the caller ID
 * every outbound call goes out on.
 *
 * Picking the caller ID is a radio, not a checkbox: choosing one un-picks the
 * rest, so the control is disabled on the number that is already active and on any
 * number that is not yet dialable (a `searching` row is still provisioning). The
 * server re-checks all of it — every disabled control here is a courtesy.
 */
export function Settings_PhoneNumbersTab() {
  const { org, isAdmin } = useAuth()
  const orgId = org?.id ?? null

  const numbersQuery = useGetNumbers(orgId)
  const setActive = useSetActiveNumber()

  const [buyOpen, setBuyOpen] = useState(false)

  if (!org || !orgId) return null

  const data = numbersQuery.data
  const numbers = data?.numbers ?? []

  function onSetActive(number: PhoneNumber) {
    setActive.mutate(
      { orgId: orgId!, id: number.id },
      {
        onSuccess: () => toast.success('Caller ID updated.'),
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.message : 'Could not update the caller ID. Try again.',
          ),
      },
    )
  }

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
              </tr>
            </thead>
            <tbody role="radiogroup" aria-label="Outbound caller ID">
              {numbers.map((number) => {
                const isActive = number.isActiveForOutbound
                // Only a dialable number that is not already the caller ID can be
                // picked. `searching`, `releasing`, and `failed` cannot call out.
                const canActivate = number.status === 'active' && !isActive
                return (
                  <tr key={number.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-sm tabular-nums">{number.e164}</td>
                    <td className="px-3 py-2 text-sm">{getPhoneNumberStatusLabel(number)}</td>
                    <td className="px-3 py-2 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="caller-id"
                          className="size-4 accent-primary"
                          checked={isActive}
                          disabled={!canActivate || setActive.isPending}
                          onChange={() => onSetActive(number)}
                          aria-label={`Set ${number.e164} as caller ID`}
                        />
                        <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>
                          {isActive ? 'Caller ID' : 'Set as caller ID'}
                        </span>
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Settings_PhoneNumbers_BuyDialog orgId={orgId} open={buyOpen} onOpenChange={setBuyOpen} />

      {isAdmin && <Settings_PhoneNumbers_OrgTable orgId={orgId} />}
    </section>
  )
}
