import { ArrowDown, ArrowUp, Phone, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetCalls } from '@/hooks/dialer'
import type { CallSortColumn } from '@/hooks/dialer'
import { useSetUrlParams, useUrlInt, useUrlString } from '@/hooks/urlState'
import { getCallStatusLabel, getTranscriptStatusLabel } from '@/lib/callLabels'
import { CALL_SORT_COLUMNS } from '@/lib/callTypes'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

const PAGE_SIZE = 25

// `sort` names the server field (server/src/routes/calls.ts → SORT_FIELDS); a
// null sort is a column the server cannot order by, so its header is plain text.
const COLUMNS: { label: string; sort: CallSortColumn | null; className?: string }[] = [
  { label: 'Number', sort: 'toE164' },
  { label: 'Outcome', sort: 'status' },
  { label: 'Duration', sort: 'durationS', className: 'w-28' },
  { label: 'Transcript', sort: null, className: 'w-32' },
  { label: 'When', sort: 'createdAt', className: 'w-52' },
]

/**
 * Every call this organization has placed, most recent first.
 *
 * Sort and page are URL state, while the entered number stays in ephemeral
 * client state so a copied link cannot expose it. The list itself is paged,
 * sorted, and searched on the SERVER — the browser never holds more than one
 * page of a history that can run to tens of thousands of rows.
 */
export function Calls() {
  const { user, org } = useAuth()

  // Safe table configuration remains navigable. The entered phone number is
  // intentionally local, while `setUrlParams` updates sort and page together.
  const setUrlParams = useSetUrlParams()
  const [search, setSearch] = useState('')
  const [sort] = useUrlString('sort', 'createdAt')
  const [dir] = useUrlString('dir', 'desc')
  const [page, setPage] = useUrlInt('page', 1)

  const orgId = org?.id ?? null
  const sortColumn: CallSortColumn = CALL_SORT_COLUMNS.includes(sort as CallSortColumn)
    ? (sort as CallSortColumn)
    : 'createdAt'
  const sortDir = dir === 'asc' ? 'asc' : 'desc'

  const callsQuery = useGetCalls(orgId, {
    page,
    limit: PAGE_SIZE,
    sort: sortColumn,
    dir: sortDir,
    q: search || undefined,
  })

  const data = callsQuery.data
  const rows = data?.calls ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function clickHeader(column: CallSortColumn | null): void {
    if (!column) return
    const nextDir = column === sortColumn && sortDir === 'asc' ? 'desc' : 'asc'
    // A new sort sends the reader back to page 1: page 4 of the old order is not
    // a place they asked to be.
    setUrlParams({ sort: column, dir: nextDir, page: null })
  }

  const hasSearch = search !== ''

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex items-center gap-2">
        <Phone size={16} aria-hidden className="text-muted-foreground" />
        <h1 className="text-base font-semibold">
          Calls{total > 0 && <span className="ml-2 text-muted-foreground tabular-nums">{total}</span>}
        </h1>
      </div>

      <Separator className="my-8" />

      <div className="flex flex-col gap-3">
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
              aria-label="Search calls by number"
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

        {callsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {callsQuery.isError && (
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-destructive">Could not load calls.</p>
            <Button variant="secondary" size="sm" onClick={() => void callsQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {data && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full">
              <caption className="sr-only">Calls placed by {org?.name}</caption>
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
                </tr>
              </thead>
              <tbody>
                {rows.map((call) => (
                  <tr key={call.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-sm tabular-nums">
                      <Link
                        to={`/calls/${call.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {call.toE164}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm">{getCallStatusLabel(call.status)}</td>
                    <td className="px-3 py-2 text-sm tabular-nums">
                      {call.durationS === null ? '—' : formatElapsed(call.durationS)}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {getTranscriptStatusLabel(call.transcriptStatus)}
                    </td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {formatDateTime(call.createdAt, user?.timeZone)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm">
                      {hasSearch
                        ? 'No call matches this number. Clear the search to see them all.'
                        : 'No calls yet. Place one from the dialer.'}
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
      </div>
    </div>
  )
}
