import type { NextFunction, Request, Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import { verifyFirebaseIdToken } from '../../dependencies/firebaseAdmin.js'
import prisma from '../db.js'
import type { UserRole } from '../lib/roles.js'

export interface AuthUser {
  id: string
  firebaseUid: string
  email: string
  firstName: string | null
  lastName: string | null
  roles: UserRole[]
  enabled: boolean
  orgId: string
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
 * `req.user.orgId` is the tenant boundary: every org-scoped query filters on it,
 * reads and writes alike (CLAUDE.md → Org Isolation & Security).
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
    include: { org: { select: { enabled: true } } },
  })

  if (!user) {
    // The token is valid but no row exists yet. GET /api/auth/me provisions the
    // Org and User on first call, so it deliberately does NOT use this middleware.
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  // A disabled user or a disabled org is 403, not 401: the caller IS who they say
  // they are, and signing out and back in will not help.
  if (!user.enabled || !user.org.enabled) {
    logger.warn({ userId: user.id, orgId: user.orgId }, 'blocked a disabled account')
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
    orgId: user.orgId,
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
