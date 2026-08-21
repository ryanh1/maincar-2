// connectionHealth.ts — THE broken-connection signal (int-health, IH-20).
//
// This is the single server-side notion of "a mailbox this rep relies on has stopped
// working". The app-wide badge (IH-26) counts what this returns, and the hub cards
// deep-link to the fix. Because a badge is only useful while reps trust it, the rule
// here is deliberately strict:
//
//   ONLY a connection stamped `status = 'error'` is broken.
//
// A `limited` connection is NOT here, and that is the whole point. `limited` means a
// scope was withheld — often a deliberate choice by the rep (they connected read-only
// on purpose). Putting a deliberate choice in an alarm the rep cannot silence teaches
// them to ignore the badge, and then it stops working as a signal for the `error` that
// actually needs them. `connected` is healthy, so it is never here either. Only a hard
// break the rep did not choose — a revoked token, an unreadable grant, an admin block —
// reaches `error`, and only `error` reaches the badge.

import prisma from '../../db.js'
import type { IntegrationErrorCode } from './integrationErrors.js'
import { providerShortName, type Provider } from '../oauthScopes.js'

/**
 * The slim shape the health badge reads: enough to COUNT and to deep-link to the fix,
 * and nothing more. No token, no scope list, no timestamps — a badge does not need
 * them, and a leaner payload is a smaller attack surface.
 */
export interface BrokenConnection {
  connectionId: string
  provider: Provider
  /** The provider's short name — a compact sidebar chip, not the card's full title. */
  providerLabel: string
  emailAddress: string
  /** The stable code from int-oauth's one table; keys the client's recovery steps. */
  errorCode: IntegrationErrorCode | null
  /** The human sentence beside the code — why this connection needs attention. */
  detail: string
}

/**
 * The rep's broken connections in one org, newest-broken first.
 *
 * Scoped to `(orgId, userId)` — a mailbox belongs to a rep, so another org's (or
 * another rep's) broken connection can never appear here. Filtered to `status: 'error'`
 * ALONE: see the file header for why a `limited` connection is deliberately excluded.
 * Ordered by `updatedAt` desc because the row's status columns are rewritten the moment
 * it breaks, so the most-recently-updated `error` row is the freshest break.
 *
 * Returns `[]` — never throws, never 404s — when nothing is broken. An empty badge is a
 * healthy answer, not an error.
 */
export async function listBrokenConnections(orgId: string, userId: string): Promise<BrokenConnection[]> {
  const rows = await prisma.oAuthConnection.findMany({
    where: { orgId, userId, status: 'error' },
    select: { id: true, provider: true, emailAddress: true, errorCode: true, statusDetail: true },
    orderBy: { updatedAt: 'desc' },
  })

  return rows.map((row) => {
    // The provider string on a stored row is always one saveConnection wrote, i.e. a Provider.
    const provider = row.provider as Provider
    return {
      connectionId: row.id,
      provider,
      providerLabel: providerShortName(provider),
      emailAddress: row.emailAddress,
      errorCode: row.errorCode as IntegrationErrorCode | null,
      detail: row.statusDetail ?? '',
    }
  })
}
