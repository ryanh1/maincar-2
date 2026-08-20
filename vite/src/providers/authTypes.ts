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
  roles: UserRole[]
  enabled: boolean
  orgId: string
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
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface MeResponse {
  user: User
  org: Org
}
