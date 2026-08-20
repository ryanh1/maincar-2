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
