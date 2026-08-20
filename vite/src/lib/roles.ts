export type UserRole = 'basic' | 'admin' | 'superadmin'

// Raw role values are never shown to a user (CLAUDE.md → Role Display Labels).
// Go through `getRoleLabel` for anything rendered.
const ROLE_LABEL: Record<UserRole, string> = {
  basic: 'Basic',
  admin: 'Admin',
  superadmin: 'Superadmin',
}

export function getRoleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? role
}

export function isAdmin(roles: UserRole[]): boolean {
  return roles.includes('admin') || roles.includes('superadmin')
}

export function isSuperadmin(roles: UserRole[]): boolean {
  return roles.includes('superadmin')
}
