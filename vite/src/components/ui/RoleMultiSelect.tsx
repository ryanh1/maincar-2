import { ChevronDown } from 'lucide-react'

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
  ASSIGNABLE_ROLES,
  getRoleDescription,
  getRoleLabel,
  sortRoles,
  type MembershipRole,
} from '@/lib/roles'
import { cn } from '@/lib/utils'

/** The roles this control can offer. `owner` is never one of them. */
export type AssignableRole = Exclude<MembershipRole, 'owner'>

/**
 * The full selection, spelled out. Feeds `title` and the trigger's accessible
 * name, so the summary in the box is never the only place the value exists.
 */
function describeRoles(roles: readonly string[]): string {
  if (roles.length === 0) return 'No role'
  return sortRoles(roles).map(getRoleLabel).join(', ')
}

/**
 * What fits in the box. Past two roles it counts rather than lists, so the
 * trigger is the same width whether someone holds one role or all of them.
 */
function summarizeRoles(roles: readonly string[]): string {
  const sorted = sortRoles(roles)
  if (sorted.length === 0) return 'No role'
  if (sorted.length <= 2) return sorted.map(getRoleLabel).join(', ')
  return `${getRoleLabel(sorted[0]!)} +${sorted.length - 1}`
}

interface Props {
  /** Roles currently held or chosen. Rendered in canonical order. */
  value: readonly string[]
  /** Called with the next set, already sorted. May be empty — see `blockedRoles`. */
  onChange: (roles: AssignableRole[]) => void
  /** Fires on open and on close, so a caller can commit a draft when it closes. */
  onOpenChange?: (open: boolean) => void
  /** Roles that cannot be unticked right now, mapped to the reason why. */
  blockedRoles?: Partial<Record<AssignableRole, string>>
  disabled?: boolean
  /** Ties the trigger to a `<Label htmlFor>`. */
  id?: string
  /** The accessible name, e.g. "Change the role of al@acme.com". */
  label: string
  className?: string
}

/**
 * The one role picker. The member list and the invite form both use it, because
 * a membership can hold more than one role and both places must say so the same
 * way.
 *
 * The trigger is ONE control: a text summary, not chips. Chips inside a button
 * take the button's hover and press states, so they read as though the chip is
 * what you are selecting, and a second chip wraps out of the fixed-height box.
 * Chips stay where nothing is interactive — the owner row and the non-admin view.
 *
 * An empty set is allowed to exist in the draft and REFUSED on commit by the
 * caller. Defaulting it here would grant a role nobody chose.
 */
export function RoleMultiSelect({
  value,
  onChange,
  onOpenChange,
  blockedRoles,
  disabled,
  id,
  label,
  className,
}: Props) {
  const selected = sortRoles(value)
  const full = describeRoles(selected)

  function toggle(role: AssignableRole, checked: boolean): void {
    const next = checked
      ? sortRoles([...selected.filter((r) => r !== role), role])
      : sortRoles(selected.filter((r) => r !== role))
    onChange(next as AssignableRole[])
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          title={full}
          aria-label={`${label}. ${full}.`}
          className={cn('w-40 justify-between font-normal', className)}
        >
          <span className="truncate">{summarizeRoles(selected)}</span>
          <ChevronDown size={16} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Roles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ASSIGNABLE_ROLES.map((role) => {
          const blocked = blockedRoles?.[role]
          return (
            <DropdownMenuCheckboxItem
              key={role}
              checked={selected.includes(role)}
              disabled={Boolean(blocked)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => toggle(role, checked)}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{getRoleLabel(role)}</span>
                <span className="text-xs text-muted-foreground">
                  {blocked ?? getRoleDescription(role)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
