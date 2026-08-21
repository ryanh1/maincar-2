// oauthConnections.ts — THE ONLY FILE IN THE CODEBASE THAT DECRYPTS A TOKEN.
//
// Every access token the app ever uses comes out of `withFreshAccessToken()`, and
// `decryptToken` is called here and in `tokenCrypto.ts` and nowhere else (a grep in
// the spec's success criteria enforces exactly that). No caller outside this file
// ever sees ciphertext, a refresh token, or a 401 — refreshing is transparent, and
// a dead grant surfaces as a typed error instead of a token that does not work.
//
// Both stored token fields are ciphertext at rest, bound by AAD to
// `${provider}:${userId}` (see the schema comment on OAuthConnection.refreshToken).
// They are never logged, never returned by a route, and never placed in a response
// body — not even to the owner.

import prisma from '../../db.js'
import { logger } from '../../../dependencies/logger.js'
import { decryptToken, encryptToken } from '../tokenCrypto.js'
import { Prisma } from '../../generated/prisma/client.js'
import type { OAuthConnection } from '../../generated/prisma/client.js'

// --- The refresh seam -------------------------------------------------------
//
// This file owns the decrypt, the write-back, and the single-flight guard. It does
// NOT own the provider HTTP call — that is a Google/Microsoft concern wired up by
// int-oauth (IH-7). The provider client is injected through `registerTokenRefresher`
// at startup and mocked in tests, so no test in this suite ever reaches a provider.

/** What a provider hands back from a successful refresh. */
export interface RefreshedGrant {
  accessToken: string
  /** Absolute expiry of the new access token, in UTC. */
  expiresAt: Date
  // Some providers (Google under rotation) mint a NEW refresh token on every
  // refresh and invalidate the old one. When present it is written back; when
  // absent the stored refresh token is kept.
  refreshToken?: string
}

export interface TokenRefreshInput {
  provider: string
  /** The DECRYPTED refresh token. It never leaves this module in plaintext. */
  refreshToken: string
  connectionId: string
}

export type TokenRefresher = (input: TokenRefreshInput) => Promise<RefreshedGrant>

let refresher: TokenRefresher | null = null

/**
 * Register the provider-refresh implementation. int-oauth (IH-7) calls this once
 * at startup with the real Google/Microsoft client; tests call it with a fake.
 */
export function registerTokenRefresher(fn: TokenRefresher): void {
  refresher = fn
}

function requireRefresher(): TokenRefresher {
  if (!refresher) {
    throw new Error(
      'oauthConnections: no token refresher registered. int-oauth (IH-7) wires the ' +
        'provider client up at startup via registerTokenRefresher().',
    )
  }
  return refresher
}

// --- Typed failures ---------------------------------------------------------
//
// A refresh can fail in two ways this module treats as terminal for the grant. Both
// carry a stable `code` the row is stamped with, and both THROW rather than return a
// token — a dead grant that is returned anyway is worse than one that is absent.

/** The provider rejected the refresh token: it was revoked or expired for good. */
export class TokenRevokedError extends Error {
  readonly code = 'token_revoked'
  constructor(message = 'The mailbox grant was revoked; the rep must reconnect.') {
    super(message)
    this.name = 'TokenRevokedError'
  }
}

/**
 * The stored ciphertext would not decrypt (wrong key, tampering, or an AAD that no
 * longer matches the row). This is NEVER treated as an absent token: absence invites
 * a silent re-fetch of something that is unrecoverable without a fresh consent.
 */
export class TokenUnreadableError extends Error {
  readonly code = 'token_unreadable'
  constructor(message = 'Stored mailbox credentials could not be read.') {
    super(message)
    this.name = 'TokenUnreadableError'
  }
}

/**
 * A refresh implementation signals a revoked grant by throwing an error whose
 * `code` is `invalid_grant` (the string every OAuth provider uses), or an
 * `InvalidGrantError`. Anything else is transient and bubbles up untouched, so a
 * provider blip is not mistaken for a revocation.
 */
export class InvalidGrantError extends Error {
  readonly code = 'invalid_grant'
  constructor(message = 'invalid_grant') {
    super(message)
    this.name = 'InvalidGrantError'
  }
}

function isInvalidGrant(err: unknown): boolean {
  if (err instanceof InvalidGrantError) return true
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'invalid_grant'
}

// --- The public, token-free shape -------------------------------------------
//
// The ONLY shape a route may return for a connection. It is built from an explicit
// `select` and an explicit field list, so it has no token field and — the point —
// it cannot grow one: a future column added to the model does not appear here unless
// a human adds it on purpose, and a test asserts the serialized JSON contains no
// substring of either token.

export const CONNECTION_PUBLIC_SELECT = {
  id: true,
  orgId: true,
  userId: true,
  provider: true,
  providerAccountId: true,
  emailAddress: true,
  scopes: true,
  status: true,
  errorCode: true,
  statusDetail: true,
  lastValidatedAt: true,
  lastRefreshAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OAuthConnectionSelect

export interface SerializedConnection {
  id: string
  provider: string
  providerAccountId: string
  emailAddress: string
  scopes: string[]
  status: string
  errorCode: string | null
  statusDetail: string | null
  lastValidatedAt: Date | null
  lastRefreshAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// A connection row as it reaches serializeConnection: the safe fields, plus the
// token fields marked optional so a FULL row (tokens and all) is still assignable —
// which is exactly what the leak test passes in to prove the tokens are dropped.
type SerializableConnectionRow = SerializedConnection & {
  orgId?: string
  userId?: string
  refreshToken?: string | null
  accessToken?: string | null
}

/**
 * Map a connection row to the token-free shape a route may return. Every field is
 * named explicitly — never spread — so no token can ride along and no future column
 * appears here by accident.
 */
export function serializeConnection(row: SerializableConnectionRow): SerializedConnection {
  return {
    id: row.id,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    emailAddress: row.emailAddress,
    scopes: row.scopes,
    status: row.status,
    errorCode: row.errorCode ?? null,
    statusDetail: row.statusDetail ?? null,
    lastValidatedAt: row.lastValidatedAt ?? null,
    lastRefreshAt: row.lastRefreshAt ?? null,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Read one connection, scoped to its org, as the token-free shape. A connection id
 * from another org returns `null` — never a thrown error that would confirm the id
 * names a real row in some other tenant.
 */
export async function getConnection(
  connectionId: string,
  orgId: string,
): Promise<SerializedConnection | null> {
  const row = await prisma.oAuthConnection.findFirst({
    where: { id: connectionId, orgId },
    select: CONNECTION_PUBLIC_SELECT,
  })
  return row ? serializeConnection(row) : null
}

// --- withFreshAccessToken: the chokepoint -----------------------------------

/** The access token is refreshed when it expires within this window. */
const EXPIRY_SKEW_MS = 60_000

// Two callers hitting the same expired connection must NOT both refresh. On
// providers that rotate the refresh token, the second refresh would invalidate the
// token the first just minted — the first caller would then hold an access token
// whose refresh token no longer works. So concurrent calls for one connection id
// share a single in-flight promise; the map entry is cleared when it settles.
const inFlight = new Map<string, Promise<string>>()

/**
 * Return a live access token for `connectionId`, refreshing transparently.
 *
 * The connection id is an unguessable capability handed down from an org-verified
 * lookup (getMailProvider). The initial read is by id, but every write-back is
 * re-scoped to the row's own `(id, orgId)` through `updateMany`, so a stale or
 * guessed id can never write across a tenant boundary.
 */
export async function withFreshAccessToken(connectionId: string): Promise<string> {
  const existing = inFlight.get(connectionId)
  if (existing) return existing

  const p = doRefreshIfNeeded(connectionId).finally(() => inFlight.delete(connectionId))
  inFlight.set(connectionId, p)
  return p
}

async function doRefreshIfNeeded(connectionId: string): Promise<string> {
  const row = await prisma.oAuthConnection.findUnique({ where: { id: connectionId } })
  if (!row) {
    throw new Error(`oauthConnections: no connection ${connectionId}`)
  }

  const aad = `${row.provider}:${row.userId}`

  // The stored access token is still comfortably in date — hand it back without
  // touching the provider or the refresh token.
  if (row.accessToken && row.expiresAt && row.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
    return decryptOrMarkUnreadable(row, row.accessToken, aad)
  }

  // A refresh is due. Decrypt the refresh token first — its failure is the
  // canonical `token_unreadable` case.
  const refreshToken = await decryptOrMarkUnreadable(row, row.refreshToken, aad)

  let grant: RefreshedGrant
  try {
    grant = await requireRefresher()({ provider: row.provider, refreshToken, connectionId: row.id })
  } catch (err) {
    if (isInvalidGrant(err)) {
      await markError(row, 'token_revoked', 'Access was revoked; reconnect the mailbox.')
      throw new TokenRevokedError()
    }
    // Transient/provider errors are not a revocation — leave the row untouched and
    // let the caller (or int-health) classify a live failure.
    throw err
  }

  // Write the new grant back, scoped to (id, orgId). A rotated refresh token is
  // re-encrypted and stored; status is left alone here, because whether a grant is
  // `limited` is a question of scopes, not of whether the token works.
  const data: Prisma.OAuthConnectionUpdateManyMutationInput = {
    accessToken: encryptToken(grant.accessToken, aad),
    expiresAt: grant.expiresAt,
    lastRefreshAt: new Date(),
  }
  if (grant.refreshToken) {
    data.refreshToken = encryptToken(grant.refreshToken, aad)
  }
  await prisma.oAuthConnection.updateMany({ where: { id: row.id, orgId: row.orgId }, data })

  return grant.accessToken
}

/**
 * Decrypt a stored token, or stamp the row `token_unreadable` and throw. A
 * decryption failure is never swallowed and never treated as an absent token.
 */
async function decryptOrMarkUnreadable(
  row: OAuthConnection,
  ciphertext: string,
  aad: string,
): Promise<string> {
  try {
    return decryptToken(ciphertext, aad)
  } catch {
    await markError(row, 'token_unreadable', 'Stored mailbox credentials could not be read.')
    // The caught error is intentionally not chained: it may carry key/ciphertext
    // detail, and nothing about a decryption failure belongs in a log or a stack
    // that leaves this file.
    throw new TokenUnreadableError()
  }
}

/** Stamp a connection with a terminal error, scoped to (id, orgId). */
async function markError(row: OAuthConnection, errorCode: string, statusDetail: string): Promise<void> {
  await prisma.oAuthConnection.updateMany({
    where: { id: row.id, orgId: row.orgId },
    data: { status: 'error', errorCode, statusDetail },
  })
  logger.warn({ connectionId: row.id, orgId: row.orgId, provider: row.provider, errorCode }, 'oauth connection marked error')
}
