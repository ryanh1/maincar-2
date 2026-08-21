export type UserRole = 'basic' | 'admin' | 'superadmin'

/**
 * Every role a membership may CARRY, strongest first — the mirror of
 * `server/src/lib/roles.ts`.
 *
 * "owner" is here but not in `ASSIGNABLE_ROLES`, and that gap is the point:
 * a member can hold it, and nothing in the member list can grant or clear it.
 */
export type MembershipRole = 'owner' | 'admin' | 'basic'

export const MEMBERSHIP_ROLES: MembershipRole[] = ['owner', 'admin', 'basic']

/** The roles an admin may tick in the role editor. */
export const ASSIGNABLE_ROLES: Exclude<MembershipRole, 'owner'>[] = ['admin', 'basic']

// Raw role values are never shown to a user (CLAUDE.md → Role Display Labels).
// Go through `getRoleLabel` for anything rendered.
const ROLE_LABEL: Record<string, string> = {
  basic: 'Basic',
  admin: 'Admin',
  owner: 'Owner',
  superadmin: 'Superadmin',
}

export function getRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

/** What each role lets a person do, for the role editor and its confirms. */
const ROLE_DESCRIPTION: Record<string, string> = {
  admin: 'Invites people, changes roles, removes members, and edits organization settings.',
  basic: 'Makes calls and works their own records.',
  owner: 'Holds the organization. This role moves by transferring ownership.',
}

export function getRoleDescription(role: string): string {
  return ROLE_DESCRIPTION[role] ?? ''
}

/**
 * Canonical order — strongest first — so the badges in a row never reorder
 * between renders, and two people with the same roles read the same way.
 */
export function sortRoles<T extends string>(roles: readonly T[]): T[] {
  return [...roles].sort(
    (a, b) =>
      MEMBERSHIP_ROLES.indexOf(a as MembershipRole) -
        MEMBERSHIP_ROLES.indexOf(b as MembershipRole) || a.localeCompare(b),
  )
}

/** The owner and an admin both hold admin authority; only one of them is the owner. */
export function isAdmin(roles: readonly string[]): boolean {
  return roles.includes('admin') || roles.includes('superadmin') || roles.includes('owner')
}

export function isSuperadmin(roles: readonly string[]): boolean {
  return roles.includes('superadmin')
}

export function isOwner(roles: readonly string[]): boolean {
  return roles.includes('owner')
}

/** Two role sets are the same set, whatever order they arrived in. */
export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = sortRoles(a)
  const right = sortRoles(b)
  return left.every((role, index) => role === right[index])
}
