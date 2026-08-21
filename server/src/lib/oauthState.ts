// oauthState.ts — the stateless, signed `state` for the OAuth consent round-trip.
//
// A rep starts consent on an authenticated route, but the provider redirects back
// to an UNAUTHENTICATED callback that carries no session. `state` is what bridges
// the two: it is CSRF protection (the callback rejects a `state` it did not sign)
// AND the carrier of whose consent this is (userId, orgId), so the callback needs
// no session and no server-side store.
//
// Format:  <payloadB64url>.<hmacB64url>
//
// The signature is HMAC-SHA256 over the payload segment. verifyState checks the
// signature FIRST, in constant time, before it trusts a single field — including
// the expiry. A payload is only ever read after its MAC is proven, so a forged or
// tampered `state` never reaches the expiry check, the JSON parse's output, or the
// callback's org lookup.

import crypto from 'node:crypto'

import { OAUTH_STATE_SECRET } from '../config.js'

/** How Maincar was asked to consent: a first connect, or a repair of a partial grant. */
export type OAuthMode = 'connect' | 'fix'

/** The claims carried across the round-trip. `iat`/`exp` are UNIX seconds. */
export interface StatePayload {
  provider: string
  userId: string
  orgId: string
  mode: OAuthMode
  /** The connection being repaired or reconnected; null when adding a new account. */
  connectionId: string | null
  /** Random per-state, so two states minted in the same second are still distinct. */
  nonce: string
  iat: number
  exp: number
}

/** What a caller supplies to {@link signState}; the nonce and timestamps are minted here. */
export interface StateInput {
  provider: string
  userId: string
  orgId: string
  mode: OAuthMode
  connectionId?: string | null
}

/** Why a `state` failed to verify. A single mismatch never says more than it must. */
export type VerifyReason = 'malformed' | 'bad_signature' | 'expired' | 'invalid_payload'

/** verifyState never throws — it returns which of the two arms happened. */
export type VerifyResult = { ok: true; payload: StatePayload } | { ok: false; reason: VerifyReason }

// Ten minutes: long enough for a rep to work through a consent screen, short
// enough that a leaked `state` is stale before it is useful.
const TTL_SECONDS = 10 * 60

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** The MAC over the payload segment, as raw bytes. The one place the secret is used. */
function sign(payloadB64: string): Buffer {
  return crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(payloadB64).digest()
}

/**
 * Mint a signed `state` for the authorize redirect. The nonce, `iat`, and `exp`
 * are set here — a caller cannot forge an issue time or extend the TTL.
 */
export function signState(input: StateInput): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: StatePayload = {
    provider: input.provider,
    userId: input.userId,
    orgId: input.orgId,
    mode: input.mode,
    connectionId: input.connectionId ?? null,
    nonce: crypto.randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + TTL_SECONDS,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${b64url(sign(payloadB64))}`
}

/**
 * Verify a `state` and return its payload, or the reason it failed. Never throws.
 *
 * Order is the security property: SHAPE → SIGNATURE → decode → structure → EXPIRY.
 * The signature is compared in constant time on equal-length buffers, and the
 * expiry is checked only AFTER the signature, so a tampered token is rejected as a
 * bad signature and never as "expired" — nothing about the payload is trusted
 * until its MAC holds.
 */
export function verifyState(token: string): VerifyResult {
  // --- Shape: exactly two non-empty segments ---
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' }
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    return { ok: false, reason: 'malformed' }
  }
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  // --- Signature FIRST, constant time on equal-length buffers ---
  const expected = sign(payloadB64)
  const provided = Buffer.from(sigB64, 'base64url')
  // timingSafeEqual throws on a length mismatch, so an unequal length — which is
  // itself a failed signature — is short-circuited before the constant-time call.
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }

  // --- Decode the payload, now that its MAC is proven ---
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // --- Structure: every claim present and well-typed ---
  if (!isStatePayload(parsed)) return { ok: false, reason: 'invalid_payload' }

  // --- Expiry, checked AFTER the signature ---
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' }

  return { ok: true, payload: parsed }
}

/** Every claim must be present and the right type before a payload is trusted. */
function isStatePayload(value: unknown): value is StatePayload {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return (
    isNonEmptyString(o.provider) &&
    isNonEmptyString(o.userId) &&
    isNonEmptyString(o.orgId) &&
    (o.mode === 'connect' || o.mode === 'fix') &&
    (o.connectionId === null || typeof o.connectionId === 'string') &&
    isNonEmptyString(o.nonce) &&
    typeof o.iat === 'number' &&
    typeof o.exp === 'number'
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
