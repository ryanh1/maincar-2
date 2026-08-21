// Request/response shapes for the org hooks. They mirror the server's keyed
// responses in server/src/routes/team.ts.
import type { Membership, Org, User } from '@/providers/authTypes'
import type { UserRole } from '@/lib/roles'

/** An org in the switcher list, carrying the caller's roles in that org. */
export interface OrgSummary extends Org {
  roles: UserRole[]
}

export interface GetOrgsResponse {
  orgs: OrgSummary[]
  total: number
}

export interface GetOrgResponse {
  org: Org
  roles: UserRole[]
}

export interface CreateOrgInput {
  name: string
}

export interface CreateOrgResponse {
  org: Org
}

export interface UpdateOrgInput {
  orgId: string
  name?: string
  logo?: string | null
}

export interface UpdateOrgResponse {
  org: Org
}

export interface SwitchOrgResponse {
  user: User
  org: Org
}

export interface OrgMember {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  title: string | null
  imageUrl: string | null
  enabled: boolean
  roles: UserRole[]
  joinedAt: string
}

export interface GetMembersResponse {
  members: OrgMember[]
  total: number
  page: number
  limit: number
}

export interface Invitation {
  id: string
  email: string
  roles: UserRole[]
  status: string
  expiresAt: string
  inviteUrl: string
  createdAt: string
}

export interface GetInvitationsResponse {
  invitations: Invitation[]
  total: number
}

export interface CreateInvitationInput {
  orgId: string
  email: string
  roles?: UserRole[]
}

export interface CreateInvitationResponse {
  invitation: Invitation
}

/** The display name for a member, falling back to the email when unnamed. */
export function memberDisplayName(member: OrgMember): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ')
  return name || member.email
}

export type { Membership }
