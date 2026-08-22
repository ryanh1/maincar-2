export interface TeamMember {
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  title: string | null
}

export interface Team {
  id: string
  orgId: string
  name: string
  leadUserId: string
  isArchived: boolean
  archivedAt: string | null
  memberUserIds: string[]
  members: TeamMember[]
  createdAt: string
  updatedAt: string
}

export interface GetTeamsParams {
  page?: number
  limit?: number
  sort?: 'name'
  dir?: 'asc' | 'desc'
  q?: string
  isArchived?: boolean
}

export interface GetTeamsResponse {
  teams: Team[]
  total: number
  page: number
  limit: number
}

export interface CreateTeamInput {
  orgId: string
  name: string
  leadUserId: string
  memberUserIds: string[]
}

export interface UpdateTeamInput {
  orgId: string
  teamId: string
  name?: string
  leadUserId?: string
  memberUserIds?: string[]
  isArchived?: boolean
}

export interface TeamResponse {
  team: Team
}
