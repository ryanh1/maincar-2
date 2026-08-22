import { useState } from 'react'
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteEmailTemplate, useGetEmailTemplates } from '@/hooks/email'
import type { EmailTemplate, EmailTemplateScope, EmailTemplateSort } from '@/hooks/email'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import type { OrgMember } from '@/hooks/orgs'
import { useSetUrlParams, useUrlInt, useUrlString } from '@/hooks/urlState'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_EmailTemplates_Form } from './Settings_EmailTemplates_Form'

/** The whole org fits in one page at the server's cap, which is what the map needs. */
const MEMBER_PAGE_SIZE = 200
const PAGE_SIZE = 25

const COLUMNS: { label: string; sort: EmailTemplateSort | null; className?: string }[] = [
  { label: 'Name', sort: 'name', className: 'w-[28%]' },
  { label: 'Subject', sort: 'subject', className: 'w-[28%]' },
  { label: 'Author', sort: 'author', className: 'w-44' },
  { label: 'Sharing', sort: null, className: 'w-36' },
]

const TEMPLATE_SCOPES: { value: Extract<EmailTemplateScope, 'private' | 'all'>; label: string }[] = [
  { value: 'private', label: 'Private templates' },
  { value: 'all', label: 'Private and organization templates' },
]

/**
 * Who wrote a template, in words a person can read.
 *
 * `createdById` is nullable and **a null is not an error** — it means the rep who
 * wrote this template has left, and the template outlived them, which is the
 * whole point of an org-shared template. Saying so is honest; blanking the cell
 * or showing a raw id is not.
 *
 * An id that is not in the member map is a member this page has not loaded, not
 * a missing person, so it says "A teammate" rather than claiming they are gone.
 */
function templateAuthorLabel(
  createdById: string | null,
  membersById: Map<string, OrgMember>,
  viewerId: string | null | undefined,
): string {
  if (!createdById) return 'Former member'
  if (viewerId && createdById === viewerId) return 'You'
  const member = membersById.get(createdById)
  return member ? memberDisplayName(member) : 'A teammate'
}

/** The UI mirrors the server's policy but never substitutes for its checks. */
function canManageTemplate(
  template: EmailTemplate,
  viewerId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (template.visibility === 'PRIVATE') return template.createdById === viewerId
  return template.createdById === viewerId || isAdmin
}

/**
 * Settings → Email templates: the subject-and-body shells this organization
 * reuses, and where they are written.
 *
 * Private templates belong to the rep who wrote them. Organization templates
 * are visible to every member, but only their creator or an organization admin
 * may manage them.
 *
 * The screen is a list OR a form, never both: the form hosts a full rich-text
 * editor, which wants the width, and swapping in place keeps the editor out of a
 * dialog that would have to nest the link dialog inside it.
 *
 * Merge fields are deliberately absent. They wait for a CRM contact source
 * (SPEC-composer-templates.md → the 2026-08-20 decision), and a merge-field
 * control with nothing behind it would be exactly the live-looking control that
 * does nothing that CLAUDE.md forbids.
 */
export function Settings_EmailTemplatesTab() {
  const { org, user, isAdmin } = useAuth()
  const orgId = org?.id ?? null

  // Like Members, the table reads its whole view from the URL. These values are
  // deliberately passed straight to the server: filtering or sorting rows after
  // they reach the browser would make the count and pagination lie.
  const setUrlParams = useSetUrlParams()
  const [search] = useUrlString('q', '')
  const [scopeParam] = useUrlString('scope', 'private')
  const [sort] = useUrlString('sort', 'name')
  const [dir] = useUrlString('dir', 'asc')
  const [page, setPage] = useUrlInt('page', 1)
  const scope = scopeParam === 'all' ? 'all' : 'private'
  const sortColumn = (COLUMNS.find((column) => column.sort === sort)?.sort ?? 'name') as EmailTemplateSort
  const sortDir = dir === 'desc' ? 'desc' : 'asc'

  const templatesQuery = useGetEmailTemplates(orgId, {
    scope,
    page,
    limit: PAGE_SIZE,
    sort: sortColumn,
    dir: sortDir,
    q: search || undefined,
  })
  // Attribution only. Any member may read the member list, so this is not an
  // admin-gated call, and a failure here costs the author column and nothing else.
  const membersQuery = useGetMembers(orgId, { limit: MEMBER_PAGE_SIZE })
  const deleteTemplate = useDeleteEmailTemplate()

  // `null` is the list. A present value is the form: `{ template: null }` writes
  // a new one, `{ template }` edits that one.
  const [editing, setEditing] = useState<{ template: EmailTemplate | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EmailTemplate | null>(null)

  if (!org || !orgId) return null

  const data = templatesQuery.data
  const templates = data?.templates ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = search !== '' || scope !== 'private'
  const membersById = new Map(
    (membersQuery.data?.members ?? []).map((member) => [member.userId, member]),
  )

  function remove(template: EmailTemplate): void {
    deleteTemplate.mutate(
      { orgId: orgId!, templateId: template.id },
      {
        onSuccess: () => {
          setConfirmDelete(null)
          toast.success(`${template.name} is gone.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not delete the template. Try again.',
          ),
      },
    )
  }

  function clickHeader(column: EmailTemplateSort | null): void {
    if (!column) return
    const nextDir = column === sortColumn && sortDir === 'asc' ? 'desc' : 'asc'
    setUrlParams({ sort: column, dir: nextDir, page: null })
  }

  function selectScope(nextScope: Extract<EmailTemplateScope, 'private' | 'all'>): void {
    setUrlParams({ scope: nextScope === 'private' ? null : nextScope, page: null })
  }

  if (editing) {
    return (
      <Settings_EmailTemplates_Form
        // A different template is a different document, and the editor inside is
        // seeded once on mount. The key is what makes that remount happen.
        key={editing.template?.id ?? 'new'}
        orgId={orgId}
        template={editing.template}
        onDone={() => setEditing(null)}
      />
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Email templates</h2>
          <p className="text-xs text-text-muted">
            Organization templates can be managed by their creator or an admin.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ template: null })}>
          New template
        </Button>
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
            placeholder="Search templates"
            aria-label="Search templates"
            value={search}
            onChange={(event) => setUrlParams({ q: event.target.value, page: null })}
          />
        </div>

        <Select value={scope} onValueChange={(value) => selectScope(value as Extract<EmailTemplateScope, 'private' | 'all'>)}>
          <SelectTrigger size="sm" aria-label="Template visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_SCOPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUrlParams({ q: null, scope: null, page: null })}
          >
            <X size={16} aria-hidden />
            Clear
          </Button>
        )}
      </div>

      {templatesQuery.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {templatesQuery.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">Could not load your templates.</p>
          <Button variant="secondary" size="sm" onClick={() => void templatesQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {data && templates.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border py-12 text-center">
          <p className="text-base font-semibold">
            {hasFilters
              ? 'No template matches this search. Clear the filters to see your templates.'
              : 'Write a template you can reuse.'}
          </p>
          {hasFilters ? (
            <Button variant="secondary" size="sm" onClick={() => setUrlParams({ q: null, scope: null, page: null })}>
              Clear filters
            </Button>
          ) : null}
        </div>
      )}

      {data && templates.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] table-fixed text-sm">
            <caption className="sr-only">Email templates for {org.name}</caption>
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
                {/* The actions column has no heading a reader needs, but a th
                    still has to say something for a screen reader walking it. */}
                <th scope="col" className="w-12 px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1 text-sm font-medium">{template.name}</td>
                  <td className="px-3 py-1 text-sm">
                    {template.subject ? (
                      template.subject
                    ) : (
                      <span className="text-muted-foreground">No subject</span>
                    )}
                  </td>
                  <td className="px-3 py-1 text-sm text-muted-foreground">
                    {membersQuery.isPending ? (
                      <Skeleton className="h-4 w-24" />
                    ) : (
                      templateAuthorLabel(template.createdById, membersById, user?.id)
                    )}
                  </td>
                  <td className="px-3 py-1 text-sm text-muted-foreground">
                    {template.visibility === 'ORGANIZATION' ? 'Organization' : 'Private'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {canManageTemplate(template, user?.id, isAdmin) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton tooltip={`Show actions for ${template.name}`}>
                            <MoreHorizontal size={16} aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing({ template })}>
                            <Pencil size={16} aria-hidden />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirmDelete(template)}
                          >
                            <Trash2 size={16} aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
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

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            {/* The consequence, and the honest limit of it: a template is copied
                into a card when it is picked, so nothing already written changes. */}
            <AlertDialogDescription>
              {confirmDelete?.visibility === 'ORGANIZATION'
                ? 'Everyone in this organization loses this template.'
                : 'This removes your private template.'}{' '}
              Emails already written from it stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteTemplate.isPending}
              onClick={(event) => {
                // Held open until the server answers, so a refused delete reports
                // its reason instead of vanishing.
                event.preventDefault()
                if (confirmDelete) remove(confirmDelete)
              }}
            >
              {deleteTemplate.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
