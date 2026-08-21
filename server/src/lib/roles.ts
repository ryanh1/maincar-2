import { z } from 'zod'

// Kept in step with vite/src/lib/roles.ts. The database column is a String[],
// never a Prisma enum (CLAUDE.md → Database / Prisma → No Enums), so this union
// is where the type safety comes from.
export type UserRole = 'basic' | 'admin' | 'superadmin'

export const USER_ROLES: UserRole[] = ['basic', 'admin', 'superadmin']

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as string[]).includes(value)
}

export function isAdmin(roles: UserRole[]): boolean {
  return roles.includes('admin') || roles.includes('superadmin')
}

export function isSuperadmin(roles: UserRole[]): boolean {
  return roles.includes('superadmin')
}

// --- Per-org roles ------------------------------------------------------------
// A Membership's roles are a DIFFERENT vocabulary from the global `UserRole`
// above: "superadmin" is a platform role and must never land on a Membership,
// because that would let an org admin mint platform staff by sending an invite.
export type OrgRole = 'basic' | 'admin'

export const ORG_ROLES: OrgRole[] = ['basic', 'admin']

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as string[]).includes(value)
}

/**
 * Every role a Membership row may CARRY, strongest first.
 *
 * "owner" is in this list but not in `ORG_ROLES`, and that gap is the point:
 * a membership can hold it, and nothing an admin does from the member list can
 * grant or clear it. Ownership moves by transferring ownership.
 */
export type MembershipRole = OrgRole | 'owner'

export const MEMBERSHIP_ROLES: MembershipRole[] = ['owner', 'admin', 'basic']

/**
 * Canonical order — strongest first — so a stored set never depends on the order
 * the admin happened to tick the boxes in. Two clicks that select the same roles
 * must produce the same row, or a no-op looks like a change.
 */
export function sortRoles<T extends string>(roles: readonly T[]): T[] {
  return [...roles].sort(
    (a, b) =>
      MEMBERSHIP_ROLES.indexOf(a as MembershipRole) -
        MEMBERSHIP_ROLES.indexOf(b as MembershipRole) || a.localeCompare(b),
  )
}

/** The roles that carry admin authority in an org, for a `hasSome` filter. */
export const ADMIN_ROLES: readonly string[] = ['owner', 'admin']

/**
 * Does this membership hold admin authority? The owner does, without carrying
 * the literal "admin" role — otherwise the org creator could be locked out of
 * their own settings, and the last-admin count would be wrong.
 */
export function hasAdminAuthority(roles: readonly string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.includes(role))
}

/** Is this the org owner? The owner row is never edited from the member list. */
export function isOwnerRole(roles: readonly string[]): boolean {
  return roles.includes('owner')
}

/**
 * The ONLY gate a role set passes through before it is written to a Membership
 * or an Invitation. It is applied twice on purpose — once when the invite is
 * created and again when it is accepted — so a row edited in the database
 * between those two moments still cannot grant anything outside this list.
 *
 * At least one role, never "owner" and never "superadmin". Empty is refused
 * rather than defaulted: a membership with no roles has no access, which is a
 * removal wearing the costume of a role change.
 *
 * Deduped and sorted strongest-first, so `["basic","admin"]`, `["admin","basic"]`
 * and `["admin","admin","basic"]` all store identically and compare equal. A
 * repeat is a client that sent the same box twice, not an attack, so it is
 * normalised rather than refused.
 */
export const assignableRolesSchema = z
  .array(z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]))
  .min(1)
  .transform((roles) => sortRoles([...new Set(roles)]))
