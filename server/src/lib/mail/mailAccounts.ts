// mailAccounts.ts — the mailbox a grant reaches, and the primary a rep sends from.
//
// Two jobs live here:
//   - `upsertMailAccount` writes exactly one mailbox row per address, and makes the
//     first mailbox a rep connects the primary, so the composer always has a
//     from-address the moment a connection exists.
//   - `setPrimaryMailbox` moves the primary flag ATOMICALLY. "Exactly one primary
//     per (orgId, userId)" is an invariant of the whole set, not of any one row, so
//     the clear and the set happen inside one transaction — see the comment there.
//
// Every query filters on `orgId`, and every mutation goes through `updateMany` /
// `deleteMany`, never `update({ where: { id } })`, so the tenant boundary lives in
// the `where` clause (rules/database-and-prisma.md).

import prisma from '../../db.js'
import { Prisma } from '../../generated/prisma/client.js'
import type { MailAccount, PrismaClient } from '../../generated/prisma/client.js'

// The client defaults to the process singleton. It is injectable ONLY so the
// integration suite can hand in a client aimed at its isolated schema
// (src/test/integration/testPrisma.ts); nothing in the app passes it.
type Db = Pick<PrismaClient, '$transaction'>
export type MailAccountsDb = Db

/**
 * The fields a completed consent hands to the mailbox layer. It is a subset of an
 * `OAuthConnection` row (`connectionId` is the connection's `id`), so the callback
 * in int-oauth (IH-10) can call this without the route ever assembling a mailbox
 * shape itself — that is what keeps a route from forgetting to create the mailbox.
 */
export interface MailboxUpsertInput {
  orgId: string
  userId: string
  connectionId: string
  provider: string
  emailAddress: string
  /** Left undefined on connect so a reconnect never wipes a name the rep set. */
  displayName?: string | null
}

/**
 * Create or update exactly one mailbox for an address. Keyed on the mailbox's own
 * unique `(orgId, emailAddress)`, so a reconnect updates the existing row rather
 * than duplicating it. The first mailbox for an `(orgId, userId)` is born primary.
 *
 * A reconnect never clobbers `isPrimary` (the rep's choice of primary survives a
 * token refresh) and never wipes `displayName` unless a new one was passed.
 */
export async function upsertMailAccount(
  connection: MailboxUpsertInput,
  db: Db = prisma,
): Promise<MailAccount> {
  const { orgId, userId, connectionId, provider, emailAddress } = connection

  return db.$transaction(async (tx) => {
    const existing = await tx.mailAccount.findFirst({
      where: { orgId, emailAddress },
      select: { id: true },
    })

    if (existing) {
      // Reconnect: rebind to the refreshed grant, leave isPrimary and the owner
      // alone. displayName is written only when the caller actually supplied one,
      // so a token refresh never wipes a name the rep set.
      const data: Prisma.MailAccountUncheckedUpdateManyInput = { connectionId, provider }
      if (connection.displayName !== undefined) data.displayName = connection.displayName
      await tx.mailAccount.updateMany({ where: { orgId, emailAddress }, data })
      return tx.mailAccount.findFirstOrThrow({ where: { orgId, emailAddress } })
    }

    // First connect: this is the primary if the rep has no other mailbox yet.
    // Counting inside the same transaction as the insert keeps "first is primary"
    // true even against a concurrent second connect.
    const isFirst = (await tx.mailAccount.count({ where: { orgId, userId } })) === 0
    return tx.mailAccount.create({
      data: {
        orgId,
        userId,
        connectionId,
        provider,
        emailAddress,
        displayName: connection.displayName ?? null,
        isPrimary: isFirst,
      },
    })
  })
}

/**
 * Make `id` the one primary mailbox for `(orgId, userId)`, moving the flag off
 * whichever mailbox held it. Returns the whole mailbox set (oldest first) on
 * success, or `null` when no mailbox with that id belongs to this rep — a foreign
 * or stale id changes nothing and does not throw a leaky error.
 *
 * The clear and the set MUST be one transaction. Two `updateMany`s outside one
 * leave a window in which zero mailboxes are primary, and the composer, reading in
 * that window, shows the rep "no mailbox connected" though they have several. The
 * first `updateMany` write-locks every mailbox row for this rep, so two concurrent
 * switches serialize on it: the later one waits, re-clears, and sets its own
 * target — the set can never end with two primaries or with none.
 */
export async function setPrimaryMailbox(
  id: string,
  orgId: string,
  userId: string,
  db: Db = prisma,
): Promise<MailAccount[] | null> {
  return db.$transaction(async (tx) => {
    // Confirm the target is this rep's before touching anything. Clearing first for
    // an id that turns out not to be ours would leave the set with zero primaries.
    const target = await tx.mailAccount.findFirst({
      where: { id, orgId, userId },
      select: { id: true },
    })
    if (!target) return null

    await tx.mailAccount.updateMany({ where: { orgId, userId }, data: { isPrimary: false } })
    await tx.mailAccount.updateMany({ where: { id, orgId, userId }, data: { isPrimary: true } })

    return tx.mailAccount.findMany({ where: { orgId, userId }, orderBy: { createdAt: 'asc' } })
  })
}
