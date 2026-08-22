import { useState } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetOrgNumbers } from '@/hooks/phoneNumbers'
import type { PhoneNumberSortColumn } from '@/hooks/phoneNumbers'
import { useSetUrlParams, useUrlInt, useUrlString } from '@/hooks/urlState'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_PhoneNumbers_OrgRow } from './Settings_PhoneNumbers_OrgRow'

const PAGE_SIZE = 25

const COLUMNS: { label: string; sort: PhoneNumberSortColumn | null; className?: string }[] = [
  { label: 'Number', sort: 'e164' },
  { label: 'Assigned to', sort: null },
  { label: 'Status', sort: 'status', className: 'w-40' },
  { label: 'Bought on', sort: 'createdAt', className: 'w-32' },
  { label: 'Primary', sort: null, className: 'w-36' },
]

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
  const setUrlParams = useSetUrlParams()
  const [search, setSearch] = useState('')
  const [sort] = useUrlString('sort', 'createdAt')
  const [dir] = useUrlString('dir', 'desc')
  const [page, setPage] = useUrlInt('page', 1)
  const sortColumn: PhoneNumberSortColumn = ['e164', 'status', 'createdAt'].includes(sort)
    ? (sort as PhoneNumberSortColumn)
    : 'createdAt'
  const sortDir = dir === 'asc' ? 'asc' : 'desc'
  const numbersQuery = useGetOrgNumbers(orgId, {
    page,
    limit: PAGE_SIZE,
    sort: sortColumn,
    dir: sortDir,
    q: search.trim() || undefined,
  })

  const data = numbersQuery.data
  const numbers = data?.numbers ?? []
  const total = data?.total ?? 0
  const hasSearch = search.trim() !== ''
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function clickHeader(column: PhoneNumberSortColumn | null): void {
    if (!column) return
    const nextDir = column === sortColumn && sortDir === 'asc' ? 'desc' : 'asc'
    setUrlParams({ sort: column, dir: nextDir, page: null })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Organization numbers</h2>
        {data && total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {total} total{data.unassignedCount > 0 && `, ${data.unassignedCount} unassigned`}
          </span>
        )}
      </div>

      {(total > 0 || hasSearch) && (
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
              aria-label="Search organization phone numbers"
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

      {data && total === 0 && !hasSearch && (
        <div className="flex items-center justify-center rounded-md border border-border py-8 text-center text-sm text-muted-foreground">
          Nobody has bought a number yet.
        </div>
      )}

      {data && (numbers.length > 0 || hasSearch) && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <caption className="sr-only">Every phone number owned by {org?.name}</caption>
            <thead>
              <tr className="border-b border-border bg-surface">
                {COLUMNS.map((column) => (
                  <th
                    key={column.label}
                    scope="col"
                    className={cn(
                      'px-4 py-2 text-left text-xs font-medium text-text-muted',
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
                <Settings_PhoneNumbers_OrgRow
                  key={number.id}
                  orgId={orgId}
                  number={number}
                  timeZone={user?.timeZone}
                  viewerId={user?.id}
                />
              ))}
              {numbers.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-6 text-center text-sm">
                    No number matches this search. Clear the search to see them all.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tabular-nums text-muted-foreground">
            Page {page} of {lastPage}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
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
    </section>
  )
}
