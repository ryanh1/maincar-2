// Request/response shapes for the org hooks. They mirror the server's keyed
// responses in server/src/routes/team.ts.
import type { Membership, Org, User } from '@/providers/authTypes'
import type { MembershipRole, UserRole } from '@/lib/roles'

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
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  title: string | null
  imageUrl: string | null
  avatarUrl: string | null
  enabled: boolean
  roles: MembershipRole[]
  joinedAt: string
  /** True for the row that is the person reading the table. */
  isSelf: boolean
}

/** What the member table asks the server for. Every field lives in the URL. */
export interface GetMembersParams {
  page?: number
  limit?: number
  sort?: MemberSortColumn
  dir?: 'asc' | 'desc'
  q?: string
  role?: string[]
}

export const MEMBER_SORT_COLUMNS = ['name', 'email', 'roles', 'joinedAt'] as const
export type MemberSortColumn = (typeof MEMBER_SORT_COLUMNS)[number]

export interface GetMembersResponse {
  members: OrgMember[]
  total: number
  page: number
  limit: number
  /** `activeAdminCount` lets the table grey out the last-admin actions early. */
  meta: { activeAdminCount: number }
  viewerRoles: MembershipRole[]
}

export interface UpdateMemberRolesInput {
  orgId: string
  userId: string
  roles: MembershipRole[]
}

export interface UpdateMemberRolesResponse {
  member: { userId: string; roles: MembershipRole[] }
}

export interface RemoveMemberInput {
  orgId: string
  userId: string
}

export interface Invitation {
  id: string
  email: string
  roles: MembershipRole[]
  status: string
  expiresAt: string
  /**
   * The IANA zone `expiresAt` is anchored in — the inviter's.
   *
   * An invite dies at the last millisecond of a day on the inviter's clock, and
   * that day only has a name alongside the zone whose midnight bounds it. Always
   * a real zone: the server resolves the fallback so the client never guesses.
   */
  expiresAtTimeZone: string
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
  /** Assignable roles only — the server refuses "owner" and every platform role. */
  roles?: Exclude<MembershipRole, 'owner'>[]
}

export interface CreateInvitationResponse {
  invitation: Invitation
}

/**
 * What GET /api/public/invitations/:token returns. Deliberately thin — anyone
 * holding the link can read it, so it carries no ids and nothing about the org
 * beyond its name.
 */
export interface PublicInvitation {
  orgName: string | null
  email: string
  roles: UserRole[]
  expiresAt: string
}

export interface GetPublicInvitationResponse {
  invitation: PublicInvitation
}

export interface AcceptInvitationResponse {
  membership: {
    orgId: string
    orgName: string | null
    roles: UserRole[]
  }
}

/** The display name for a member, falling back to the email when unnamed. */
export function memberDisplayName(member: Pick<OrgMember, 'firstName' | 'lastName' | 'email'>): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ')
  return name || member.email
}

export type { Membership }
