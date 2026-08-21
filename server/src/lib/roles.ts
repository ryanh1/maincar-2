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
 * The ONLY gate a role set passes through before it is written to a Membership
 * or an Invitation. It is applied twice on purpose — once when the invite is
 * created and again when it is accepted — so a row edited in the database
 * between those two moments still cannot grant anything outside this list.
 *
 * Deduped and sorted so `["admin","admin","basic"]` and `["basic","admin"]`
 * store identically and compare equal.
 */
export const assignableRolesSchema = z
  .array(z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]))
  .min(1)
  .transform((roles) => [...new Set(roles)].sort())
