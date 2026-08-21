import { useState } from 'react'
import { MoreHorizontal, UserMinus } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { memberDisplayName, useRemoveMember } from '@/hooks/orgs'
import type { OrgMember } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/datetime'
import { isAdmin, isOwner } from '@/lib/roles'

import { Settings_Members_Avatar } from './Settings_Members_Avatar'
import { Settings_Members_RoleEditor } from './Settings_Members_RoleEditor'

interface Props {
  member: OrgMember
  orgId: string
  viewerIsAdmin: boolean
  activeAdminCount: number
  timeZone: string | null | undefined
}

/** One row of the members table: who they are, what they hold, and what an admin can do. */
export function Settings_Members_MemberRow({
  member,
  orgId,
  viewerIsAdmin,
  activeAdminCount,
  timeZone,
}: Props) {
  const removeMember = useRemoveMember()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const name = memberDisplayName(member)
  const memberIsOwner = isOwner(member.roles)
  // The server refuses to remove the owner, the last admin, and to let a
  // non-admin remove anyone. The menu anticipates all three.
  const isLastAdmin = isAdmin(member.roles) && activeAdminCount <= 1
  const canRemove = viewerIsAdmin && !memberIsOwner && !isLastAdmin

  function remove(): void {
    removeMember.mutate(
      { orgId, userId: member.userId },
      {
        onSuccess: () => {
          setConfirmRemove(false)
          toast.success(`${member.email} no longer has access to this organization.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not remove the member. Try again.',
          ),
      },
    )
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2">
        <div className="flex items-center gap-3">
          <Settings_Members_Avatar
            name={name === member.email ? null : name}
            email={member.email}
            imageUrl={member.imageUrl}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {name}
              {member.isSelf && <span className="ml-2 text-xs text-muted-foreground">You</span>}
            </span>
            {member.title && (
              <span className="block truncate text-xs text-muted-foreground">{member.title}</span>
            )}
          </span>
        </div>
      </td>
      <td className="px-4 py-2">
        <span className="block truncate text-sm text-muted-foreground">{member.email}</span>
      </td>
      <td className="px-4 py-2">
        <Settings_Members_RoleEditor
          member={member}
          orgId={orgId}
          viewerIsAdmin={viewerIsAdmin}
          activeAdminCount={activeAdminCount}
        />
      </td>
      <td className="px-4 py-2">
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(member.joinedAt, timeZone)}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        {viewerIsAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton tooltip={`Show actions for ${member.email}`}>
                <MoreHorizontal size={16} aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                disabled={!canRemove}
                onSelect={() => setConfirmRemove(true)}
              >
                <UserMinus size={16} aria-hidden />
                {memberIsOwner
                  ? 'Transfer ownership first'
                  : isLastAdmin
                    ? 'Promote another admin first'
                    : 'Remove from organization'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {member.email} from this organization?</AlertDialogTitle>
              {/* The specific consequence, not "Are you sure?" — and the honest
                  limit of it: this is an offboard, not an account deletion. */}
              <AlertDialogDescription>
                This person loses access to this organization right away. Their Maincar account
                stays, along with every other organization they belong to. You can invite them back
                later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={removeMember.isPending}
                onClick={(event) => {
                  // Hold the dialog open until the server answers, so a refused
                  // removal reports its reason instead of vanishing.
                  event.preventDefault()
                  remove()
                }}
              >
                {removeMember.isPending ? 'Removing…' : 'Remove'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}
