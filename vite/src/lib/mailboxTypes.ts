/**
 * The client's view of a rep's send-from addresses. The shapes here MIRROR the server
 * (server/src/routes/mailboxes.ts) and add nothing the API does not send — a mailbox is
 * token-free by construction, so this file never carries a credential either.
 *
 * A mailbox is one connected address a rep can send from. Its `status` mirrors the
 * parent connection, so a row shows the same trouble the connection card does, and
 * exactly one mailbox per `(org, rep)` is `isPrimary` — the composer's default sender.
 *
 * `Provider` is imported from integrationTypes rather than re-declared, so the two
 * views of "which providers Maincar integrates" cannot drift.
 */
import type { ConnectionStatus, IntegrationErrorCode, Provider } from '@/lib/integrationTypes'

/**
 * One send-from address. Mirrors the server `Mailbox`, with `connectedAt` an ISO string
 * because that is what JSON carries. `status` and `statusDetail` are the parent
 * connection's, so a mailbox row can show its own trouble without a second fetch.
 */
export interface Mailbox {
  id: string
  provider: Provider
  providerLabel: string
  emailAddress: string
  displayName: string | null
  isPrimary: boolean
  /** Mirrors the parent connection, so a row can show its own trouble. */
  status: ConnectionStatus
  statusDetail: string
  errorCode: IntegrationErrorCode | null
  lastValidatedAt: string | null
  connectionId: string
  connectedAt: string
  backfill: {
    status: 'running' | 'complete' | 'failed'
    scannedCount: number
    matchedCount: number
    completedAt: string | null
  } | null
}

/** What GET /api/mailboxes/orgs/:orgId returns: this rep's mailboxes, oldest first. */
export interface GetMailboxesResponse {
  mailboxes: Mailbox[]
}

/**
 * What POST …/:mailboxId/primary and DELETE …/:mailboxId return: the WHOLE list, not the
 * one changed row. "Exactly one is primary" is a property of the SET, so the set comes
 * back — returning a single row would let the client render two primaries between
 * responses.
 */
export interface MailboxListResponse {
  mailboxes: Mailbox[]
}

/** What PATCH …/:mailboxId returns: the one renamed mailbox, wrapped like the server keys it. */
export interface MailboxResponse {
  mailbox: Mailbox
}
