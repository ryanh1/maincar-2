/**
 * The mailbox routes: a rep's list of send-from addresses, and the three actions on a
 * row — rename, promote to primary, disconnect. Mounted at `/api/mailboxes/orgs/:orgId`,
 * so the org is in the path and membership is re-proven on every request from it
 * (server/src/lib/membership.ts) — nothing here trusts the caller's `currentOrgId`, a
 * preference the client can set, to decide which tenant's mailboxes a request touches.
 *
 * A mailbox belongs to a REP, not just an org, so every query is scoped to
 * `(orgId, userId)`: another rep's — or another org's — id is simply not found and
 * answered 404, never a 403 that would confirm the id names a real row.
 *
 * "Exactly one mailbox is primary" is an invariant of the SET, not of any one row, so
 * the two routes that can change it (promote, delete) return the WHOLE list. Returning
 * the single changed row would let the client render two primaries between responses.
 * The atomic flag move lives in mailAccounts.ts (`setPrimaryMailbox` / `deleteMailbox`);
 * these routes only prove ownership and hand back the token-free public shape.
 *
 * No token can ride along in a response: MailAccount holds no credential, and the one
 * relation read here (`connection`) is selected down to its status columns, never its
 * tokens. A route test asserts the JSON carries neither.
 */
import { Router } from 'express'
import { z } from 'zod'

import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { Prisma } from '../generated/prisma/client.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { deleteMailbox, setPrimaryMailbox } from '../lib/mail/mailAccounts.js'
import { isProvider } from '../lib/mail/oauthProviders.js'
import { requireMembership } from '../lib/membership.js'
import { providerShortName } from '../lib/oauthScopes.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

// mergeParams so `:orgId` from the mount path (/api/mailboxes/orgs/:orgId) reaches
// req.params here — without it the tenant id every scope depends on would be
// undefined and every membership check would silently fail open.
const router = Router({ mergeParams: true })

router.use(requireAuth)

/** The token-free shape the hub renders per mailbox. One per connected address. */
export interface Mailbox {
  id: string
  provider: 'google' | 'microsoft'
  providerLabel: string
  emailAddress: string
  displayName: string | null
  isPrimary: boolean
  /** Mirrors the parent connection, so a row can show its own trouble. */
  status: 'connected' | 'limited' | 'error'
  statusDetail: string
  connectionId: string
  connectedAt: string
}

/** A display name is the rep's private label; capped so a runaway value is rejected. */
const DISPLAY_NAME_MAX = 80
export const DISPLAY_NAME_TOO_LONG = `A mailbox name must be ${DISPLAY_NAME_MAX} characters or fewer.`

const patchBody = z.object({
  // Nullable so the rep can clear a name; the too-long case carries a named message
  // the client can show verbatim rather than a generic "invalid body".
  displayName: z.string().max(DISPLAY_NAME_MAX, DISPLAY_NAME_TOO_LONG).nullable(),
})

// The mailbox columns a route may read, plus its parent connection's status — never a
// token. Built from an explicit `select` so no credential column can appear here by
// accident, the way CONNECTION_PUBLIC_SELECT protects the connection shape.
const MAILBOX_PUBLIC_SELECT = {
  id: true,
  provider: true,
  emailAddress: true,
  displayName: true,
  isPrimary: true,
  connectionId: true,
  createdAt: true,
  connection: { select: { status: true, statusDetail: true } },
} satisfies Prisma.MailAccountSelect

type MailboxRow = Prisma.MailAccountGetPayload<{ select: typeof MAILBOX_PUBLIC_SELECT }>

/**
 * Map a mailbox row to the token-free public shape. Every field is named explicitly —
 * never spread — so nothing rides along by accident. The status is the parent
 * connection's, so a mailbox row shows the same trouble the connection card does.
 */
function serializeMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    provider: isProvider(row.provider) ? row.provider : 'google',
    providerLabel: isProvider(row.provider) ? providerShortName(row.provider) : row.provider,
    emailAddress: row.emailAddress,
    displayName: row.displayName ?? null,
    isPrimary: row.isPrimary,
    status: (row.connection?.status ?? 'error') as Mailbox['status'],
    statusDetail: row.connection?.statusDetail ?? '',
    connectionId: row.connectionId,
    connectedAt: row.createdAt.toISOString(),
  }
}

/** This rep's mailboxes in this org, oldest first — the same order a primary change returns. */
async function loadMailboxes(orgId: string, userId: string): Promise<Mailbox[]> {
  const rows = await prisma.mailAccount.findMany({
    where: { orgId, userId },
    orderBy: { createdAt: 'asc' },
    select: MAILBOX_PUBLIC_SELECT,
  })
  return rows.map(serializeMailbox)
}

/** One mailbox in the public shape, scoped to this rep — or null when it is not theirs. */
async function loadMailbox(id: string, orgId: string, userId: string): Promise<Mailbox | null> {
  const row = await prisma.mailAccount.findFirst({
    where: { id, orgId, userId },
    select: MAILBOX_PUBLIC_SELECT,
  })
  return row ? serializeMailbox(row) : null
}

// ============================================================
// GET /api/mailboxes/orgs/:orgId — the rep's send-from list
// ============================================================
// Every mailbox this rep has connected in this org, each carrying its parent
// connection's status so a row can show its own trouble. An empty set is
// `{ mailboxes: [] }`, never a 404.
router.get(
  '/',
  wrapRoute('GET /api/mailboxes/orgs/:orgId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute query & return response ---
    res.json({ mailboxes: await loadMailboxes(orgId, userId) })
  }),
)

// ============================================================
// PATCH /api/mailboxes/orgs/:orgId/:mailboxId — rename a mailbox
// ============================================================
// Sets the rep's private display name (the composer's sender picker shows it). The
// write is a scoped `updateMany`, so a foreign or stale id matches zero rows and is
// 404, never an `update({ where: { id } })` that would write another rep's row.
router.patch(
  '/:mailboxId',
  wrapRoute('PATCH /api/mailboxes/orgs/:orgId/:mailboxId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const mailboxId = String(req.params.mailboxId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Parse & validate params ---
    const parsed = patchBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      // A too-long name carries its own named message; anything else is a generic 400.
      const tooLong = parsed.error.issues.find((issue) => issue.message === DISPLAY_NAME_TOO_LONG)
      return void res.status(400).json({ error: tooLong ? DISPLAY_NAME_TOO_LONG : 'Provide a valid display name.' })
    }
    // An empty or whitespace-only name clears the label rather than storing blanks.
    const raw = parsed.data.displayName
    const displayName = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null

    // --- Execute write ---
    // Scoped to (id, orgId, userId): another rep's id matches zero rows → 404.
    const result = await prisma.mailAccount.updateMany({
      where: { id: mailboxId, orgId, userId },
      data: { displayName },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Mailbox not found' })
    }

    // --- Return response ---
    const mailbox = await loadMailbox(mailboxId, orgId, userId)
    if (!mailbox) {
      return void res.status(404).json({ error: 'Mailbox not found' })
    }
    res.json({ mailbox })
  }),
)

// ============================================================
// POST /api/mailboxes/orgs/:orgId/:mailboxId/primary — set the sender
// ============================================================
// Moves the one Primary flag onto this mailbox, ATOMICALLY, and returns the WHOLE
// list: "exactly one is primary" is a property of the set, so the set is the answer —
// returning one row would let the client show two primaries between responses. The
// clear-and-set lives in setPrimaryMailbox, which serializes concurrent switches on a
// row lock so the set can never end with two primaries or with none.
router.post(
  '/:mailboxId/primary',
  wrapRoute('POST /api/mailboxes/orgs/:orgId/:mailboxId/primary', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const mailboxId = String(req.params.mailboxId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute write ---
    // setPrimaryMailbox scopes its target lookup to (id, orgId, userId), so another
    // rep's id changes nothing and returns null → 404.
    const moved = await setPrimaryMailbox(mailboxId, orgId, userId)
    if (!moved) {
      return void res.status(404).json({ error: 'Mailbox not found' })
    }

    // --- Return response ---
    // Re-read in the public shape (status and all), rather than serializing the raw
    // rows setPrimaryMailbox returns, so the list carries the same fields GET does.
    res.json({ mailboxes: await loadMailboxes(orgId, userId) })
  }),
)

// ============================================================
// DELETE /api/mailboxes/orgs/:orgId/:mailboxId — disconnect a mailbox
// ============================================================
// Removes the mailbox and, when it was the primary, promotes the newest remaining one
// in the SAME transaction, so the rep is never left with mailboxes and no sender. The
// whole list comes back for the same reason a promote returns it. All of the delete +
// promote lives in deleteMailbox; this route proves ownership, logs, and answers. A
// foreign id deletes nothing and is 404.
router.delete(
  '/:mailboxId',
  wrapRoute('DELETE /api/mailboxes/orgs/:orgId/:mailboxId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const mailboxId = String(req.params.mailboxId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute delete ---
    // deleteMailbox scopes the lookup and the delete to (id, orgId, userId); a foreign
    // or stale id removes nothing and returns null → 404.
    const remaining = await deleteMailbox(mailboxId, orgId, userId)
    if (!remaining) {
      return void res.status(404).json({ error: 'Mailbox not found' })
    }

    // No address, no token — just the tenant and the rep.
    logger.info({ orgId, userId }, 'disconnected a mailbox')

    // --- Return response ---
    res.json({ mailboxes: await loadMailboxes(orgId, userId) })
  }),
)

export default router
