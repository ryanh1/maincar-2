import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetOrgNumbers } from '@/hooks/phoneNumbers'
import { useAuth } from '@/providers/useAuth'

import { Settings_PhoneNumbers_OrgRow } from './Settings_PhoneNumbers_OrgRow'

/**
 * Admin-only: every phone number the organization owns, and who holds each one.
 *
 * The sibling table above this one shows the signed-in admin's OWN numbers —
 * this one exists because an admin cannot answer "which number belongs to
 * which rep" from that alone (MAI-197). The server 403s a non-admin, so this
 * component is only ever rendered behind `isAdmin`.
 */
export function Settings_PhoneNumbers_OrgTable({ orgId }: { orgId: string }) {
  const { org, user } = useAuth()
  const numbersQuery = useGetOrgNumbers(orgId)

  const data = numbersQuery.data
  const numbers = data?.numbers ?? []

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Organization numbers</h2>
        {data && data.total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {data.total} total{data.unassignedCount > 0 && `, ${data.unassignedCount} unassigned`}
          </span>
        )}
      </div>

      {numbersQuery.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {numbersQuery.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">Could not load the organization's numbers.</p>
          <Button variant="secondary" size="sm" onClick={() => void numbersQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {data && numbers.length === 0 && (
        <div className="flex items-center justify-center rounded-md border border-border py-8 text-center text-sm text-muted-foreground">
          Nobody has bought a number yet.
        </div>
      )}

      {data && numbers.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <caption className="sr-only">Every phone number owned by {org?.name}</caption>
            <thead>
              <tr className="border-b border-border bg-surface">
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-text-muted">
                  Number
                </th>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-text-muted">
                  Assigned to
                </th>
                <th scope="col" className="w-40 px-4 py-2 text-left text-xs font-medium text-text-muted">
                  Status
                </th>
                <th scope="col" className="w-32 px-4 py-2 text-left text-xs font-medium text-text-muted">
                  Bought
                </th>
                <th scope="col" className="w-36 px-4 py-2 text-left text-xs font-medium text-text-muted">
                  Primary
                </th>
                <th scope="col" className="w-12 px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((number) => (
                <Settings_PhoneNumbers_OrgRow
                  key={number.id}
                  orgId={orgId}
                  number={number}
                  timeZone={user?.timeZone}
                  viewerId={user?.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
