import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { RoleMultiSelect, type AssignableRole } from '@/components/ui/RoleMultiSelect'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUpdateMemberRoles } from '@/hooks/orgs'
import type { OrgMember } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import {
  getRoleLabel,
  isAdmin,
  isOwner,
  sameRoles,
  sortRoles,
  type MembershipRole,
} from '@/lib/roles'

interface Props {
  member: OrgMember
  orgId: string
  viewerIsAdmin: boolean
  /** How many people can still administer this org, from the list's `meta`. */
  activeAdminCount: number
}

/**
 * The role cell: badges when it is read-only, the shared multi-select when it
 * is not.
 *
 * A multi-select, not a single-value dropdown — one person can hold more than
 * one role, and forcing a choice would silently drop the other one. The same
 * control runs the invite form, so the two cannot drift.
 */
export function Settings_Members_RoleEditor({
  member,
  orgId,
  viewerIsAdmin,
  activeAdminCount,
}: Props) {
  const updateRoles = useUpdateMemberRoles()
  const [draft, setDraft] = useState<MembershipRole[] | null>(null)

  const roles = sortRoles(member.roles)
  const memberIsOwner = isOwner(roles)
  // Demoting the only remaining admin is refused by the server. Greying it out
  // says so before the click; the server still re-checks it.
  const isLastAdmin = isAdmin(roles) && activeAdminCount <= 1
  const canEdit = viewerIsAdmin && !memberIsOwner

  if (!canEdit) {
    // Chips are right here: nothing in this cell is interactive, so they cannot
    // pick up a control's hover or press state.
    // The provider comes from App.tsx, at the root.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex h-8 flex-wrap items-center gap-1">
            {roles.map((role) => (
              <Badge key={role} variant="secondary">
                {getRoleLabel(role)}
              </Badge>
            ))}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {memberIsOwner
            ? "The owner's role changes by transferring ownership."
            : 'Only an admin can change roles.'}
        </TooltipContent>
      </Tooltip>
    )
  }

  const selected = draft ?? roles

  function commit(open: boolean): void {
    if (open) {
      setDraft(roles as MembershipRole[])
      return
    }
    const next = draft
    setDraft(null)
    if (!next) return

    // Refused rather than defaulted: a member with no roles has no access, which
    // is a removal wearing the costume of a role change.
    if (next.length === 0) {
      toast.error('Pick at least one role.')
      return
    }
    // Compare as sets — the order the boxes were ticked in is not a change.
    if (sameRoles(next, roles)) return

    updateRoles.mutate(
      { orgId, userId: member.userId, roles: next },
      {
        onSuccess: () =>
          toast.success(`${member.email} is now ${next.map(getRoleLabel).join(' and ')}.`),
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not change the role. Try again.',
          ),
      },
    )
  }

  return (
    <RoleMultiSelect
      value={selected}
      onChange={(next) => setDraft(next as MembershipRole[])}
      onOpenChange={commit}
      disabled={updateRoles.isPending}
      label={`Change the role of ${member.email}`}
      blockedRoles={
        isLastAdmin && selected.includes('admin' as AssignableRole)
          ? { admin: 'Promote someone else to admin first.' }
          : undefined
      }
    />
  )
}
