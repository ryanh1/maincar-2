export interface SyncQueueHealth {
  queue: string
  queueDepth: number
  failureCount: number
  deadLetterCount: number
}

export interface SyncAccountHealth {
  id: string
  orgId: string
  orgName: string | null
  emailAddress: string
  provider: string
  lastSyncedAt: string | null
  cursorAgeSeconds: number | null
  syncRuns: number
  fullResyncs: number
  fullResyncRate: number | null
  messagesScanned: number
  messagesMatched: number
  matchRate: number | null
}

export interface SyncSubscriptionHealth {
  mailAccountId: string
  orgId: string
  orgName: string | null
  emailAddress: string
  kind: string
  expiresAt: string
  expiresInSeconds: number
}

export interface AdminSyncHealthResponse {
  syncHealth: {
    generatedAt: string
    windowHours: number
    queues: SyncQueueHealth[]
    accounts: SyncAccountHealth[]
    subscriptions: SyncSubscriptionHealth[]
    holdBuffer: {
      total: number
      byOrg: Array<{ orgId: string; orgName: string | null; count: number }>
    }
  }
}
