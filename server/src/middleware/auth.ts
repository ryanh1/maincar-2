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
  timeZone: string | null
  /** Private foreground call-alert preferences, read only by the owner's route. */
  callAlertSettings: unknown
  /** Private notification timing preferences, read only by the owner's route. */
  notificationDeliverySettings: unknown
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}

/**
 * Codes Firebase Admin reports when the verification request never completed —
 * DNS, TCP, TLS or timeout. The token is not implicated by any of them.
 */
const TRANSPORT_ERROR_CODES = new Set([
  'app/network-error',
  'app/network-timeout',
  'auth/network-error',
  'auth/network-request-failed',
  'auth/timeout',
])

/**
 * Node and undici syscall codes. Firebase Admin usually reports these only in
 * the message ("Error code: ECONNREFUSED") while `code` stays `app/network-error`,
 * so both places are checked.
 */
const TRANSPORT_SYSCALL_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]

interface CodeCarrier {
  code?: unknown
  errorInfo?: { code?: unknown }
  message?: unknown
  cause?: unknown
}

/**
 * The most specific code the error carries. `FirebaseAuthError` puts it on both
 * `code` and `errorInfo.code`; a raw socket error puts it on `code` alone.
 */
export function firebaseErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = err

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const e = current as CodeCarrier
    if (typeof e.code === 'string' && e.code) return e.code
    if (typeof e.errorInfo?.code === 'string' && e.errorInfo.code) return e.errorInfo.code
    current = e.cause
  }
  return undefined
}

/**
 * True when the verification never reached Firebase.
 *
 * Deliberately an ALLOWLIST: anything unrecognized keeps the old 401. Guessing
 * "outage" for an unknown failure would let a genuinely bad token through the
 * only gate that stops it, so the ambiguous case still fails closed.
 */
export function isTransportFailure(err: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = err

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const e = current as CodeCarrier

    for (const code of [e.code, e.errorInfo?.code]) {
      if (typeof code !== 'string') continue
      if (TRANSPORT_ERROR_CODES.has(code)) return true
      if (TRANSPORT_SYSCALL_CODES.includes(code)) return true
    }

    const message = e.message
    if (typeof message === 'string' && TRANSPORT_SYSCALL_CODES.some((c) => message.includes(c))) {
      return true
    }

    current = e.cause
  }
  return false
}

/**
 * The one answer to "Firebase did not respond".
 *
 * Shared so every token-verifying entry point sends the SAME status, copy,
 * `Retry-After` and log line. `GET /api/auth/me` cannot use `requireAuth` (it
 * provisions the User row), so without this the two would drift and an outage
 * would still 401 on the one route the client uses to decide about signing out.
 */
export function respondFirebaseUnreachable(res: Response, err: unknown): void {
  logger.error(
    { err, firebaseErrorCode: firebaseErrorCode(err) },
    'could not reach Firebase to verify a token, so the request was not authenticated',
  )
  res.setHeader('Retry-After', '5')
  res.status(503).json({ error: 'Cannot reach the sign-in service. Try again in a moment.' })
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
 *
 * A failure to REACH Firebase is not a 401. It answers 503 so the caller keeps
 * its session and retries — see the catch below.
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
  } catch (err) {
    // Two very different failures used to share this catch (MAI-12). A token
    // Firebase REJECTED is the caller's problem and stays 401. A request that
    // never reached Firebase is ours: answering 401 for an outage tells every
    // signed-in user their session is gone and sends them to a sign-in page that
    // is down for the same reason, so a blip reads as a mass sign-out.
    if (isTransportFailure(err)) {
      respondFirebaseUnreachable(res, err)
      return
    }

    logger.debug({ firebaseErrorCode: firebaseErrorCode(err) }, 'rejected a token')
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
    timeZone: user.timeZone,
    callAlertSettings: user.callAlertSettings,
    notificationDeliverySettings: user.notificationDeliverySettings,
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

/** Mount after `requireAuth`. Hide the operator surface from non-platform users. */
export function requireSuperadmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.roles.includes('superadmin')) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  next()
}
