import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useUpdateMemberRoles } from '@/hooks/orgs'
import type { OrgMember } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import {
  ASSIGNABLE_ROLES,
  getRoleDescription,
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
 * The role cell: badges when it is read-only, a checkbox menu when it is not.
 *
 * A multi-select, not a single-value dropdown — one person can hold more than
 * one role, and forcing a choice would silently drop the other one.
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

  const badges = (
    <span className="flex flex-wrap items-center gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="secondary">
          {getRoleLabel(role)}
        </Badge>
      ))}
    </span>
  )

  if (!canEdit) {
    // The provider is local because the app mounts none at the root. Radix allows
    // nesting, so adding one here cannot fight a future global provider.
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex h-8 items-center">{badges}</span>
          </TooltipTrigger>
          <TooltipContent>
            {memberIsOwner
              ? "The owner's role changes by transferring ownership."
              : 'Only an admin can change roles.'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const selected = draft ?? roles

  function toggle(role: MembershipRole, checked: boolean): void {
    const next = checked
      ? sortRoles([...selected.filter((r) => r !== role), role])
      : sortRoles(selected.filter((r) => r !== role))
    setDraft(next as MembershipRole[])
  }

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
    <DropdownMenu onOpenChange={commit}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={updateRoles.isPending}
          aria-label={`Change the role of ${member.email}`}
        >
          {badges}
          <ChevronDown size={16} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Roles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ASSIGNABLE_ROLES.map((role) => {
          const blocked = role === 'admin' && isLastAdmin && selected.includes(role)
          return (
            <DropdownMenuCheckboxItem
              key={role}
              checked={selected.includes(role)}
              disabled={blocked}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => toggle(role, checked)}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{getRoleLabel(role)}</span>
                <span className="text-xs text-muted-foreground">
                  {blocked
                    ? 'Promote someone else to admin first.'
                    : getRoleDescription(role)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
