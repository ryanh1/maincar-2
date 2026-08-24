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
  mine?: boolean
}

export type AccountTimelineFilterValue = Pick<AccountTimelineParams, 'sourceType' | 'personId' | 'dealId' | 'mine'>

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

interface TimelineDetailBase {
  id: string
  occurredAt?: string
  actorName?: string | null
}

export interface AccountTimelineCallDetail extends TimelineDetailBase {
  type: 'call'
  transcript?: string | null
  openFullCallPath?: string
}

export interface AccountTimelineEmailDetail extends TimelineDetailBase {
  type: 'email'
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  sentAt: string | null
  receivedAt: string | null
  participants: Array<{ id: string; role: string; name: string | null; address: string; personId: string | null }>
  attachments: Array<{ id: string; filename: string | null; contentType: string | null; sizeBytes: number | null; isInline: boolean; isStored: boolean }>
}

export interface AccountTimelineSmsMessage {
  id: string
  direction: string
  fromE164: string
  toE164: string
  body: string | null
  status: string
  sentAt: string | null
  deliveredAt: string | null
  createdAt: string
  media: Array<{ id: string; contentType: string; sizeBytes: number | null; isStored: boolean }>
}

export interface AccountTimelineSmsDetail extends TimelineDetailBase, AccountTimelineSmsMessage {
  type: 'sms'
  conversation?: AccountTimelineSmsMessage[]
}

export interface AccountTimelineMeetingDetail extends TimelineDetailBase {
  type: 'meeting'
  title: string
  description: string | null
  isAllDay: boolean
  startsAt: string | null
  endsAt: string | null
  startDate: string | null
  endDate: string | null
  timeZone: string | null
  status: string
  location: string | null
  joinUrl: string | null
  webLink: string | null
  hasRecording: boolean
  recordingUrl?: string | null
  recordingProvider: string | null
  transcriptStatus: string | null
  attendees: Array<{ id: string; email: string; name: string | null; responseStatus: string }>
}

export interface AccountTimelineNoteDetail extends TimelineDetailBase {
  type: 'note'
  bodyText: string
  bodyJson: unknown
  authorName: string | null
  links?: Array<{ object: string; id: string }>
  createdAt: string
  updatedAt: string
}

export interface AccountTimelineTaskDetail extends TimelineDetailBase {
  type: 'task'
  title: string
  body: string | null
  taskType: string
  priority: string
  commitment: string
  assigneeUserId: string | null
  assigneeName: string | null
  dueAt: string | null
  isDone: boolean
  doneAt: string | null
  links?: Array<{ object: string; id: string }>
}

export interface AccountTimelineStageChangeDetail extends TimelineDetailBase {
  type: 'stage_change'
  dealId: string
  marker: AccountTimelineEventMarker | null
}

export type AccountTimelineDetail =
  | AccountTimelineCallDetail
  | AccountTimelineEmailDetail
  | AccountTimelineSmsDetail
  | AccountTimelineMeetingDetail
  | AccountTimelineNoteDetail
  | AccountTimelineTaskDetail
  | AccountTimelineStageChangeDetail
  | (TimelineDetailBase & { type: 'record_created' | 'custom'; values?: unknown })

export interface GetAccountTimelineDetailResponse {
  event: AccountTimelineEvent
  detail: AccountTimelineDetail
  navigation: { previousEventId: string | null; nextEventId: string | null }
}
