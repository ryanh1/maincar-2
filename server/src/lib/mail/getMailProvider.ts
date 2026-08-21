// getMailProvider.ts — THE FACTORY, and the ONE switch on provider in the entire
// repo (SPEC-int-seam.md § Code style, IH-17).
//
// This is the seam's front door. A caller — composer-send, a sync job, the calendar
// — asks for a mailbox by (mailAccountId, orgId) and gets back a `MailProvider` it
// can `sendEmail` / read / write calendar on, never learning whether Gmail or Graph
// is underneath. Adding a third provider is a new `case` here and a new
// implementation file; it is NOT a change at any call site. So the grep in the
// spec's success criteria holds: `provider === 'google'` lives only under
// `server/src/dependencies/` and `server/src/lib/mail/`, and every branch on which
// provider a mailbox is lives in THIS function.
//
// ORG SCOPING. The lookup is `findFirst({ where: { id, orgId } })`, like every other
// query in this app (rules/database-and-prisma.md). A mailbox id from another org
// simply does not match, so it throws `MailboxNotFoundError` — the same error a
// deleted mailbox throws — and never a leak that would confirm the id names a real
// row in some other tenant.

import prisma from '../../db.js'
import { googleMail } from './googleMail.js'
import { microsoftMail } from './microsoftMail.js'
import { MailApiError, MailboxNotFoundError } from './mailErrors.js'
import type { MailProvider } from './MailProvider.js'

/**
 * Resolve one mailbox to its `MailProvider`, scoped to `orgId`.
 *
 * Throws `MailboxNotFoundError` when no mailbox with that id belongs to this org —
 * whether it was deleted or belongs to another tenant, the caller cannot tell the
 * difference, and that is the point.
 */
export async function getMailProvider(mailAccountId: string, orgId: string): Promise<MailProvider> {
  const account = await prisma.mailAccount.findFirst({
    where: { id: mailAccountId, orgId },
    select: { id: true, provider: true, connectionId: true, emailAddress: true },
  })
  if (!account) throw new MailboxNotFoundError(mailAccountId)

  switch (account.provider) {
    case 'google':
      return googleMail(account)
    case 'microsoft':
      return microsoftMail(account)
    // A provider string that reached the database but has no implementation is a bug
    // in int-oauth (the module that writes the connection and its mailbox), not a
    // runtime condition to degrade around. It fails loud rather than returning a
    // half-working mailbox.
    default:
      throw new MailApiError(`No implementation for mail provider "${account.provider}".`)
  }
}
