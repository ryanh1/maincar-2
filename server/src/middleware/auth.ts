import type { NextFunction, Request, Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import { verifyFirebaseIdToken } from '../../dependencies/firebaseAdmin.js'
import prisma from '../db.js'
import type { UserRole } from '../lib/roles.js'

/**
 * The verified caller. Every field here is safe to act on.
 *
 * There is deliberately NO org on this object. Which org a request acts in comes
 * from the route (`/orgs/:orgId`) and is authorized per request against the
 * caller's Membership. `User.currentOrgId` is only a UI preference, and putting
 * it here — among fields that ARE authoritative — would invite a future route to
 * filter on it and inherit a stale org after a membership is revoked. Read it
 * from the database in the one place that needs it instead.
 */
export interface AuthUser {
  id: string
  firebaseUid: string
  email: string
  firstName: string | null
  lastName: string | null
  roles: UserRole[]
  enabled: boolean
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

/**
 * Verifies the Firebase ID token and attaches the matching `User` row to the
 * request. Every authenticated route mounts this ahead of `wrapRoute`.
 *
 * With multi-org support, users can belong to multiple orgs. The currentOrgId
 * is their active org for UI context; org-scoped routes verify membership independently.
 *
 * The 401 responses stay deliberately vague. Telling a caller whether the token
 * was invalid or the account merely unknown is information they have not earned.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  let firebaseUid: string
  try {
    const decoded = await verifyFirebaseIdToken(token)
    firebaseUid = decoded.uid
  } catch {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { firebaseUid },
  })

  if (!user) {
    // The token is valid but no row exists yet. GET /api/auth/me provisions the
    // User on first call, so it deliberately does NOT use this middleware.
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  // A disabled user is 403, not 401: the caller IS who they say they are.
  if (!user.enabled) {
    logger.warn({ userId: user.id }, 'blocked a disabled account')
    res.status(403).json({ error: 'This account is disabled' })
    return
  }

  req.user = {
    id: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles as UserRole[],
    enabled: user.enabled,
  }

  next()
}

/** Mount after `requireAuth`. Rejects anyone who is not an admin. */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const roles = req.user?.roles ?? []
  if (!roles.includes('admin') && !roles.includes('superadmin')) {
    res.status(403).json({ error: 'You do not have access to this' })
    return
  }
  next()
}
