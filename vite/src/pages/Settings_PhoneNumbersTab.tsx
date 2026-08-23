import { useState } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGetNumbers } from '@/hooks/phoneNumbers'
import type { PhoneNumberSortColumn } from '@/hooks/phoneNumbers'
import { useSetUrlParams, useUrlInt, useUrlString } from '@/hooks/urlState'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_PhoneNumbers_BuyDialog } from './Settings_PhoneNumbers_BuyDialog'
import { Settings_PhoneNumbers_CallerNamePreference } from './Settings_PhoneNumbers_CallerNamePreference'
import { Settings_PhoneNumbers_OrgTable } from './Settings_PhoneNumbers_OrgTable'
import { Settings_PhoneNumbers_Row } from './Settings_PhoneNumbers_Row'

const PAGE_SIZE = 25

type SortColumn = PhoneNumberSortColumn

// This table opts into the server's list query. The caller-ID picker omits that
// query and continues to receive the caller's complete number list.
const COLUMNS: { label: string; sort: SortColumn | null; className?: string }[] = [
  { label: 'Number', sort: 'e164' },
  { label: 'Status', sort: 'status', className: 'w-40' },
  { label: 'Bought on', sort: 'createdAt', className: 'w-32' },
  { label: 'Primary', sort: null, className: 'w-36' },
]

/**
 * Settings → Phone numbers: the numbers this organization owns, and the number
 * every outbound call goes out on.
 *
 * Picking the number to call from is a radio, not a checkbox: choosing one
 * un-picks the rest, so the control is disabled on the number that is already
 * active and on any number that is not yet dialable (a `searching` row is still
 * provisioning). The server re-checks all of it — every disabled control here is
 * a courtesy.
 *
 * Each row also carries the one action that stops the org paying for a number:
 * releasing it. That lives in Settings_PhoneNumbers_Row, behind a confirm.
 *
 * Sort and page remain navigable URL state. Search text stays ephemeral so a
 * copied link never exposes a phone number.
 */
export function Settings_PhoneNumbersTab() {
  const { org, user, isAdmin } = useAuth()
  const orgId = org?.id ?? null

  const [buyOpen, setBuyOpen] = useState(false)
  const [myNumbersFilter, setMyNumbersFilter] = useState({ orgId, isAdmin, value: !isAdmin })
  // A member can switch organizations without this page unmounting. A filter
  // choice belongs to the current org and role, so a changed context starts at
  // its safe default without an effect that schedules a second render.
  const myNumbersOnly =
    myNumbersFilter.orgId === orgId && myNumbersFilter.isAdmin === isAdmin
      ? myNumbersFilter.value
      : !isAdmin

  const setUrlParams = useSetUrlParams()
  const [search, setSearch] = useState('')
  const [sort] = useUrlString('sort', 'createdAt')
  const [dir] = useUrlString('dir', 'desc')
  const [page, setPage] = useUrlInt('page', 1)

  const sortColumn: SortColumn = ['e164', 'status', 'createdAt'].includes(sort)
    ? (sort as SortColumn)
    : 'createdAt'
  const sortDir = dir === 'asc' ? 'asc' : 'desc'
  // This unpaged query is deliberately distinct from the table query: the
  // caller-name setting must always describe the currently primary number,
  // even when that row is outside a searched or paged table view.
  const callerNameNumbersQuery = useGetNumbers(orgId)
  const numbersQuery = useGetNumbers(orgId, {
    page,
    limit: PAGE_SIZE,
    sort: sortColumn,
    dir: sortDir,
    q: search.trim() || undefined,
  })

  if (!org || !orgId) return null

  const data = numbersQuery.data
  const primaryNumber = callerNameNumbersQuery.data?.numbers.find((number) => number.isActiveForOutbound)
  const numbers = data?.numbers ?? []
  const hasSearch = search.trim() !== ''
  const showMyNumbers = !isAdmin || myNumbersOnly
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function clickHeader(column: SortColumn | null): void {
    if (!column) return
    const nextDir = column === sortColumn && sortDir === 'asc' ? 'desc' : 'asc'
    // A new sort sends the reader back to page 1: page 4 of the old order is not
    // a place they asked to be.
    setUrlParams({ sort: column, dir: nextDir, page: null })
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Phone numbers</h2>
        {total > 0 && (
          <Button size="sm" onClick={() => setBuyOpen(true)}>
            Buy a number
          </Button>
        )}
      </div>

      <Settings_PhoneNumbers_CallerNamePreference
        orgId={orgId}
        number={primaryNumber}
        isPending={callerNameNumbersQuery.isPending}
        isError={callerNameNumbersQuery.isError}
      />

      <div className="flex items-center gap-2">
        <label htmlFor="my-numbers-only" className="text-sm font-medium">
          Show only my numbers
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Switch
                id="my-numbers-only"
                aria-label="Show only my numbers"
                checked={myNumbersOnly}
                disabled={!isAdmin}
                onCheckedChange={(value) => setMyNumbersFilter({ orgId, isAdmin, value })}
              />
            </span>
          </TooltipTrigger>
          {!isAdmin && <TooltipContent>You must be an admin to do that.</TooltipContent>}
        </Tooltip>
      </div>

      {showMyNumbers && (total > 0 || hasSearch) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              size={16}
              aria-hidden
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-8 pl-8"
              placeholder="Search by number"
              aria-label="Search phone numbers"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1) }}
            />
          </div>

          {hasSearch && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setPage(1) }}>
              <X size={16} aria-hidden />
              Clear
            </Button>
          )}
        </div>
      )}

      {showMyNumbers && numbersQuery.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {showMyNumbers && numbersQuery.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">Could not load your numbers.</p>
          <Button variant="secondary" size="sm" onClick={() => void numbersQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {showMyNumbers && data && total === 0 && !hasSearch && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border py-12 text-center">
          <p className="text-base font-semibold">You need a number to call out.</p>
          <Button size="sm" onClick={() => setBuyOpen(true)}>
            Buy a number
          </Button>
        </div>
      )}

      {showMyNumbers && data && (numbers.length > 0 || hasSearch) && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <caption className="sr-only">Phone numbers owned by {org.name}</caption>
            <thead>
              <tr className="border-b border-border bg-surface">
                {COLUMNS.map((column) => (
                  <th
                    key={column.label}
                    scope="col"
                    className={cn(
                      'px-3 py-2 text-left text-xs font-medium text-text-muted',
                      column.className,
                    )}
                  >
                    {column.sort ? (
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
                        onClick={() => clickHeader(column.sort)}
                        aria-label={`Sort by ${column.label}`}
                      >
                        {column.label}
                        {sortColumn === column.sort &&
                          (sortDir === 'asc' ? (
                            <ArrowUp size={14} aria-hidden />
                          ) : (
                            <ArrowDown size={14} aria-hidden />
                          ))}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                <th scope="col" className="w-12 px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((number) => (
                <Settings_PhoneNumbers_Row
                  key={number.id}
                  number={number}
                  orgId={orgId}
                  timeZone={user?.timeZone}
                  // `readyCount` is computed against the whole server-side
                  // result, not only this page, so the release warning remains
                  // accurate when the fallback number is elsewhere in the list.
                  hasOtherActiveNumber={number.status === 'active' && data.readyCount > 1}
                />
              ))}
              {numbers.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-sm">
                    No number matches this search. Clear the search to see them all.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showMyNumbers && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tabular-nums text-muted-foreground">
            Page {page} of {lastPage}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Settings_PhoneNumbers_BuyDialog orgId={orgId} open={buyOpen} onOpenChange={setBuyOpen} />

      {isAdmin && !showMyNumbers && <Settings_PhoneNumbers_OrgTable orgId={orgId} />}
    </section>
  )
}
