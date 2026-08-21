// The shapes GET /api/auth/me returns. Kept in their own module (not in
// AuthProvider.tsx) so the zustand store can import them without pulling a React
// component into its module graph.
import type { UserRole } from '@/lib/roles'

export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  title: string | null
  /**
   * Global platform roles. NOT the roles that decide what this user may do inside
   * an org — those are per-org and live on `Membership.roles`, because a user can
   * run one org and be a plain member of another. Read `useAuth().isAdmin`, which
   * resolves the active org's membership, rather than reading this.
   */
  roles: UserRole[]
  enabled: boolean
  /** The org the session is acting in. Null when the user belongs to none yet. */
  currentOrgId: string | null
  /**
   * IANA timezone (e.g. "America/New_York"), captured during onboarding. Every
   * time-of-day shown to this user is rendered in it (CLAUDE.md → Dates & Times).
   * Null until onboarding sets it.
   */
  timeZone: string | null
  createdAt: string
  updatedAt: string
}

export interface Org {
  id: string
  name: string | null
  logo: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** One org the user belongs to, plus the roles they hold in THAT org. */
export interface Membership {
  orgId: string
  org: Org
  roles: UserRole[]
}

export interface MeResponse {
  user: User
  /** Null when the user belongs to no enabled org yet. */
  org: Org | null
  memberships: Membership[]
}
