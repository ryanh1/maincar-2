// Request/response shapes for the profile hooks. They mirror the server's keyed
// responses in server/src/routes/auth.ts.
import type { Membership, Org, User } from '@/providers/authTypes'

export interface UpdateProfileInput {
  firstName?: string
  lastName?: string
  title?: string | null
  timeZone?: string
  /** Admins of the ACTIVE org only. Ignored by the server for everyone else. */
  orgName?: string
}

export interface UpdateProfileResponse {
  user: User
  org: Org | null
  memberships: Membership[]
}
