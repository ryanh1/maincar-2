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
import { evaluateGrant, type Provider } from '../oauthScopes.js'

// The client defaults to the process singleton. It is injectable ONLY so the
// integration suite can hand in a client aimed at its isolated schema
// (src/test/integration/testPrisma.ts); nothing in the app passes it.
type Db = Pick<PrismaClient, '$transaction'>
type PrimaryMailboxDb = Pick<PrismaClient, 'mailAccount'>
export type MailAccountsDb = Db

const HEALTHY_PRIMARY_MAILBOX_SELECT = {
  id: true,
  orgId: true,
  userId: true,
  connectionId: true,
  provider: true,
  emailAddress: true,
  connection: {
    select: { status: true, errorCode: true, statusDetail: true, scopes: true },
  },
} satisfies Prisma.MailAccountSelect

/** The minimal, token-free account a Calendar provider receives from the Integration Hub. */
export type HealthyPrimaryMailbox = Omit<
  Prisma.MailAccountGetPayload<{ select: typeof HEALTHY_PRIMARY_MAILBOX_SELECT }>,
  'connection'
>

/**
 * Calendar is optional, so a rep without a usable primary sender needs a recovery
 * path rather than an implicit fallback to an arbitrary connected account.
 */
export class NoHealthyPrimaryMailboxError extends Error {
  constructor(message = 'Connect a healthy primary mailbox in Settings → Integrations to use Calendar.') {
    super(message)
    this.name = 'NoHealthyPrimaryMailboxError'
  }
}

/**
 * Resolve Calendar's account when Calendar is actually requested. The lookup is
 * intentionally not cached: changing the Integration Hub primary changes the next
 * Calendar request's source without moving data or mutating a saved selection.
 */
export async function getHealthyPrimaryMailbox(
  orgId: string,
  userId: string,
  db: PrimaryMailboxDb = prisma,
): Promise<HealthyPrimaryMailbox> {
  const mailbox = await db.mailAccount.findFirst({
    where: { orgId, userId, isPrimary: true },
    select: HEALTHY_PRIMARY_MAILBOX_SELECT,
  })
  if (
    !mailbox ||
    (mailbox.provider !== 'google' && mailbox.provider !== 'microsoft') ||
    mailbox.connection.status !== 'connected' ||
    evaluateGrant(mailbox.provider as Provider, mailbox.connection.scopes).status !== 'connected'
  ) {
    throw new NoHealthyPrimaryMailboxError()
  }
  const { connection: _connection, ...account } = mailbox
  return account
}

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
 * Create or update exactly one mailbox for a grant. A reconnect first matches the
 * stable `connectionId`, so an address change updates that mailbox rather than
 * colliding with the one-to-one relation. The address is the fallback for legacy
 * reconnects. Both lookups include `(orgId, userId)`; one rep can never rebind
 * another rep's mailbox. The first mailbox for an `(orgId, userId)` is born primary.
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
    const byConnection = await tx.mailAccount.findFirst({
      where: { connectionId, orgId, userId },
      select: { id: true },
    })
    const existing =
      byConnection ??
      (await tx.mailAccount.findFirst({
        where: { orgId, userId, emailAddress },
        select: { id: true },
      }))

    if (existing) {
      // Reconnect: keep the mailbox row and the rep's primary choice, while updating
      // the grant, provider, and provider-reported address. displayName is written
      // only when the caller supplied one, so a refresh never wipes a private label.
      const data: Prisma.MailAccountUncheckedUpdateManyInput = {
        connectionId,
        provider,
        emailAddress,
      }
      if (connection.displayName !== undefined) data.displayName = connection.displayName
      await tx.mailAccount.updateMany({ where: { id: existing.id, orgId, userId }, data })
      return tx.mailAccount.findFirstOrThrow({ where: { id: existing.id, orgId, userId } })
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

/**
 * Delete mailbox `id` from this rep's set and, WHEN it was the primary, promote the
 * most-recently-connected mailbox that remains — both inside one transaction. Returns
 * the remaining set (oldest first) on success, or `null` when no mailbox with that id
 * belongs to this rep: a foreign or stale id deletes nothing and returns null, so the
 * route answers 404 without a leaky error.
 *
 * Two invariants ride on the single transaction:
 *   - A rep is NEVER left with mailboxes and no primary. Deleting the primary and
 *     promoting a replacement in two separate statements would leave a window with
 *     zero primaries, and the composer, reading in it, shows "no mailbox connected"
 *     though the rep has several. The delete and the promote commit together.
 *   - The rep's CHOICE of primary survives the delete of a non-primary. The promote
 *     runs ONLY when the row removed was the primary; removing any other mailbox
 *     leaves the existing primary exactly where the rep put it (AC 5 promotes on the
 *     removal of the primary, not on every removal).
 */
export async function deleteMailbox(
  id: string,
  orgId: string,
  userId: string,
  db: Db = prisma,
): Promise<MailAccount[] | null> {
  return db.$transaction(async (tx) => {
    // Confirm the target is this rep's before deleting, so a foreign id changes
    // nothing and the promote below never runs against another rep's set.
    const target = await tx.mailAccount.findFirst({
      where: { id, orgId, userId },
      select: { isPrimary: true },
    })
    if (!target) return null

    await tx.mailAccount.deleteMany({ where: { id, orgId, userId } })

    // Only the removal of the PRIMARY needs a replacement. The newest remaining
    // mailbox is promoted; clearing first keeps the set from ever holding two.
    if (target.isPrimary) {
      const remaining = await tx.mailAccount.findFirst({
        where: { orgId, userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (remaining) {
        await tx.mailAccount.updateMany({ where: { orgId, userId }, data: { isPrimary: false } })
        await tx.mailAccount.updateMany({
          where: { id: remaining.id, orgId, userId },
          data: { isPrimary: true },
        })
      }
    }

    return tx.mailAccount.findMany({ where: { orgId, userId }, orderBy: { createdAt: 'asc' } })
  })
}
