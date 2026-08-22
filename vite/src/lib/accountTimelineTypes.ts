/** Client-side shapes returned by `GET /api/orgs/:orgId/account-timeline`. */
export type AccountTimelineRoot =
  | { type: 'company'; id: string }
  | { type: 'deal'; id: string }

export type AccountTimelineSourceType =
  | 'call'
  | 'email'
  | 'sms'
  | 'meeting'
  | 'note'
  | 'stage_change'
  | 'task'
  | 'record_created'
  | 'custom'

export type AccountTimelineDirection = 'outbound' | 'inbound'

export interface AccountTimelineParams {
  occurredFrom?: string
  occurredTo?: string
  limit?: number
  sourceType?: AccountTimelineSourceType
  direction?: AccountTimelineDirection
  personId?: string
  dealId?: string
}

export interface AccountTimelineEventDisplay {
  actorName?: string
  companyName?: string
  personName?: string
  dealName?: string
}

export interface AccountTimelineEventMarker {
  type: 'deal_created' | 'stage_moved' | 'closed_won' | 'closed_lost'
  before?: string
  after?: string
}

export interface AccountTimelineEvent {
  id: string
  sourceType: AccountTimelineSourceType
  sourceId: string
  title: string
  preview: string | null
  subtype: string | null
  intensity: 1 | 2 | 3 | 4 | 5
  display: AccountTimelineEventDisplay
  marker: AccountTimelineEventMarker | null
  direction: AccountTimelineDirection | null
  occurredAt: string
  companyId: string | null
  personId: string | null
  dealId: string | null
}

export interface AccountTimelineRange {
  from: string
  to: string
  isDefault: boolean
}

export interface GetAccountTimelineResponse {
  events: AccountTimelineEvent[]
  nextCursor: string | null
  range: AccountTimelineRange
}
