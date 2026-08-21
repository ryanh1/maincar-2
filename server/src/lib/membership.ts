/**
 * The org gate every org-scoped route goes through.
 *
 * Membership IS the tenant boundary, so it is checked on the server for each
 * request rather than trusted from `currentOrgId` (a preference the client can
 * set). A caller with no membership, one whose membership has been deactivated,
 * or one whose org is disabled gets the same answer an org that does not exist
 * would give: 404. Telling them the org is real but off-limits leaks that it
 * exists.
 *
 * `isActive: false` is what offboarding writes, so filtering on it here is what
 * makes a removal take effect on the removed person's very next request.
 *
 * Pass `{ admin: true }` for a route only an org admin may call. That is a 403,
 * not a 404 — the caller can see the org, they just cannot do this to it.
 *
 * It lives here rather than in one router because every org-scoped router needs
 * the same gate, and a second copy of a tenant boundary is a second place for it
 * to drift.
 */
import type { Response } from 'express'

import prisma from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { hasAdminAuthority } from './roles.js'
import type { Membership, Org } from '../generated/prisma/client.js'

export async function requireMembership(
  req: AuthenticatedRequest,
  res: Response,
  orgId: string,
  opts: { admin?: boolean } = {},
): Promise<(Membership & { org: Org }) | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.id, orgId, isActive: true },
    include: { org: true },
  })

  if (!membership || !membership.org.enabled) {
    res.status(404).json({ error: 'Organization not found' })
    return null
  }

  if (opts.admin && !hasAdminAuthority(membership.roles)) {
    res.status(403).json({ error: 'Only an admin can do this' })
    return null
  }

  return membership
}
