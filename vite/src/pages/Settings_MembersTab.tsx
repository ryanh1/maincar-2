import { ArrowDown, ArrowUp, ChevronDown, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetMembers } from '@/hooks/orgs'
import type { MemberSortColumn } from '@/hooks/orgs'
import {
  toggleArrayValue,
  useSetUrlParams,
  useUrlArray,
  useUrlInt,
  useUrlString,
} from '@/hooks/urlState'
import { ASSIGNABLE_ROLES, getRoleLabel, isAdmin } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_Members_InviteForm } from './Settings_Members_InviteForm'
import { Settings_Members_MemberRow } from './Settings_Members_MemberRow'
import { Settings_Members_PendingInvites } from './Settings_Members_PendingInvites'

const PAGE_SIZE = 25

// Proportions, not guesses: name and email share what is left after the two
// fixed columns, so the table fills the wider settings shell instead of huddling
// in the middle of it. Matches Loadwire's user table.
const COLUMNS: { label: string; sort: MemberSortColumn | null; className?: string }[] = [
  { label: 'Name', sort: 'name', className: 'w-[34%]' },
  { label: 'Email', sort: 'email', className: 'w-[34%]' },
  { label: 'Role', sort: null, className: 'w-44' },
  { label: 'Joined', sort: 'joinedAt', className: 'w-32' },
]

/**
 * Settings → Members: who is in this organization, what they hold, and how an
 * admin changes or ends it.
 *
 * Search, role filter, sort, and page all live in the QUERY STRING, so a reload
 * or a pasted link restores the same view. The list itself is paged, sorted, and
 * searched on the server — the browser never holds more than one page.
 *
 * Every disabled control here is a courtesy. The server re-checks all of it.
 */
export function Settings_MembersTab() {
  const { user, org } = useAuth()

  // Everything the table is showing lives in the URL, so a reload or a pasted
  // link restores the same view. `setUrlParams` writes several of them at once —
  // two single-key setters in one handler would clobber each other.
  const setUrlParams = useSetUrlParams()
  const [search] = useUrlString('q', '')
  const [sort] = useUrlString('sort', 'joinedAt')
  const [dir] = useUrlString('dir', 'asc')
  const [roleFilter] = useUrlArray('role')
  const [page, setPage] = useUrlInt('page', 1)

  const orgId = org?.id ?? null
  const sortColumn = (COLUMNS.find((c) => c.sort === sort)?.sort ?? 'joinedAt') as MemberSortColumn
  const sortDir = dir === 'desc' ? 'desc' : 'asc'

  const membersQuery = useGetMembers(orgId, {
    page,
    limit: PAGE_SIZE,
    sort: sortColumn,
    dir: sortDir,
    q: search || undefined,
    role: roleFilter,
  })

  if (!org || !orgId) return null

  const data = membersQuery.data
  const viewerIsAdmin = isAdmin(data?.viewerRoles ?? [])
  const activeAdminCount = data?.meta.activeAdminCount ?? 0

  const rows = data?.members ?? []

  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function clickHeader(column: MemberSortColumn | null): void {
    if (!column) return
    const nextDir = column === sortColumn && sortDir === 'asc' ? 'desc' : 'asc'
    // A new sort sends the reader back to page 1: page 4 of the old order is not
    // a place they asked to be.
    setUrlParams({ sort: column, dir: nextDir, page: null })
  }

  const hasFilters = search !== '' || roleFilter.length > 0

  return (
    <div className="flex flex-col gap-6">
      {viewerIsAdmin && <Settings_Members_InviteForm orgId={orgId} />}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Members{total > 0 && <span className="ml-2 text-muted-foreground">{total}</span>}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 max-w-sm flex-1">
            <Search
              size={16}
              aria-hidden
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-8 pl-8"
              placeholder="Search name or email"
              aria-label="Search members"
              value={search}
              onChange={(event) => setUrlParams({ q: event.target.value, page: null })}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Plain text, not a Badge: a chip inside a button takes the
                  button's hover and press states and reads as a second control. */}
              <Button
                variant="outline"
                size="sm"
                aria-label={`Filter by role${roleFilter.length > 0 ? `, ${roleFilter.length} selected` : ''}`}
              >
                Role
                {roleFilter.length > 0 && (
                  <span className="tabular-nums text-muted-foreground">
                    {roleFilter.length}
                  </span>
                )}
                <ChevronDown size={16} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 p-1">
              {ASSIGNABLE_ROLES.map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                >
                  <Checkbox
                    checked={roleFilter.includes(role)}
                    onCheckedChange={() =>
                      setUrlParams({ role: toggleArrayValue(roleFilter, role), page: null })
                    }
                  />
                  {getRoleLabel(role)}
                </label>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUrlParams({ q: null, role: [], page: null })}
            >
              <X size={16} aria-hidden />
              Clear
            </Button>
          )}
        </div>

        {membersQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {membersQuery.isError && (
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-destructive">Could not load members.</p>
            <Button variant="secondary" size="sm" onClick={() => void membersQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {data && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Members of {org.name}</caption>
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
                {rows.map((member) => (
                  <Settings_Members_MemberRow
                    key={member.userId}
                    member={member}
                    orgId={orgId}
                    viewerIsAdmin={viewerIsAdmin}
                    activeAdminCount={activeAdminCount}
                    timeZone={user?.timeZone}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm">
                      {hasFilters
                        ? 'No member matches this search. Clear the filters to see everyone.'
                        : 'Invite someone to work with you.'}
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
      </section>

      {viewerIsAdmin && (
        <Settings_Members_PendingInvites
          orgId={orgId}
          enabled={viewerIsAdmin}
          timeZone={user?.timeZone}
        />
      )}
    </div>
  )
}
