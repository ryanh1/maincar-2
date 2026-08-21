import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteEmailTemplate, useGetEmailTemplates } from '@/hooks/email'
import type { EmailTemplate } from '@/hooks/email'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import type { OrgMember } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

import { Settings_EmailTemplates_Form } from './Settings_EmailTemplates_Form'

/** The whole org fits in one page at the server's cap, which is what the map needs. */
const MEMBER_PAGE_SIZE = 200

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

/**
 * Settings → Email templates: the subject-and-body shells this organization
 * reuses, and where they are written.
 *
 * **Templates are org-shared** (SPEC-composer-templates.md § 2). Every member
 * sees the same list and any member may write, edit, or delete any row —
 * including one they did not write. There is no "my templates".
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
  const { org, user } = useAuth()
  const orgId = org?.id ?? null

  const templatesQuery = useGetEmailTemplates(orgId)
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
        <h2 className="text-base font-semibold">Email templates</h2>
        {templates.length > 0 && (
          <Button size="sm" onClick={() => setEditing({ template: null })}>
            New template
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
          <p className="text-base font-semibold">Write a template your team can reuse.</p>
          <Button size="sm" onClick={() => setEditing({ template: null })}>
            New template
          </Button>
        </div>
      )}

      {data && templates.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <caption className="sr-only">Email templates shared across {org.name}</caption>
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Subject
                </th>
                <th scope="col" className="w-48 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Author
                </th>
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
                  <td className="px-2 py-1 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              Everyone in this organization loses this template. Emails already written from it stay
              as they are.
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
