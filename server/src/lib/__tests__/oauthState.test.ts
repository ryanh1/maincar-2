import crypto from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { signState, verifyState, type StateInput } from '../oauthState.js'

// The suite sets OAUTH_STATE_SECRET in src/test/setup.ts before config loads, so
// it is the exact key the module signs with. The forgery tests recompute a MAC
// with it to mint a payload that verifies but is shaped wrong — something no
// public API of the module lets you do otherwise.
const SECRET = process.env.OAUTH_STATE_SECRET as string

const BASE: StateInput = {
  provider: 'google',
  userId: 'user_123',
  orgId: 'org_abc',
  mode: 'connect',
  connectionId: null,
}

/** Sign an arbitrary payload object the way the module does, with the test's key. */
function forge(payload: object): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest().toString('base64url')
  return `${payloadB64}.${sig}`
}

describe('oauthState', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips: a freshly signed state verifies and returns its claims', () => {
    const token = signState(BASE)
    const result = verifyState(token)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.provider).toBe('google')
    expect(result.payload.userId).toBe('user_123')
    expect(result.payload.orgId).toBe('org_abc')
    expect(result.payload.mode).toBe('connect')
    expect(result.payload.connectionId).toBeNull()
    expect(result.payload.nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.payload.exp - result.payload.iat).toBe(10 * 60)
  })

  it('emits the <payloadB64url>.<hmacB64url> shape', () => {
    const parts = signState(BASE).split('.')
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('carries connectionId through on a fix, and mints a fresh nonce each call', () => {
    const a = verifyState(signState({ ...BASE, mode: 'fix', connectionId: 'conn_9' }))
    const b = verifyState(signState({ ...BASE, mode: 'fix', connectionId: 'conn_9' }))
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.payload.connectionId).toBe('conn_9')
    expect(a.payload.mode).toBe('fix')
    expect(a.payload.nonce).not.toBe(b.payload.nonce)
  })

  it('fails as bad_signature when one payload character is changed', () => {
    const [payloadB64, sig] = signState(BASE).split('.')
    // Flip the first payload character to a different valid base64url character,
    // leaving the signature — computed over the original — in place.
    const swapped = payloadB64[0] === 'A' ? 'B' : 'A'
    const tampered = `${swapped}${payloadB64.slice(1)}.${sig}`

    expect(verifyState(tampered)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('fails as bad_signature when the signature is forged', () => {
    const [payloadB64] = signState(BASE).split('.')
    const forgedSig = Buffer.alloc(32, 0).toString('base64url')
    expect(verifyState(`${payloadB64}.${forgedSig}`)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('fails as malformed when the token is truncated to a single segment', () => {
    const [payloadB64] = signState(BASE).split('.')
    // The signature (and its separator) lopped off — a truncated token.
    expect(verifyState(payloadB64)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState('')).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState('a.b.c')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('fails as expired when the TTL has passed — checked only after the signature', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const token = signState(BASE)

    // Walk past the 10-minute TTL. The signature is still valid; only exp changed.
    vi.advanceTimersByTime((10 * 60 + 1) * 1000)
    expect(verifyState(token)).toEqual({ ok: false, reason: 'expired' })
  })

  it('still verifies one second inside the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const token = signState(BASE)

    vi.advanceTimersByTime((10 * 60 - 1) * 1000)
    expect(verifyState(token).ok).toBe(true)
  })

  it('fails as invalid_payload when a validly-signed payload is missing orgId', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = forge({
      provider: 'google',
      userId: 'user_123',
      mode: 'connect',
      connectionId: null,
      nonce: 'n',
      iat: now,
      exp: now + 600,
      // orgId omitted on purpose
    })

    expect(verifyState(token)).toEqual({ ok: false, reason: 'invalid_payload' })
  })

  it('fails as invalid_payload when mode is not connect or fix', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = forge({
      provider: 'google',
      userId: 'user_123',
      orgId: 'org_abc',
      mode: 'delete',
      connectionId: null,
      nonce: 'n',
      iat: now,
      exp: now + 600,
    })

    expect(verifyState(token)).toEqual({ ok: false, reason: 'invalid_payload' })
  })

  it('checks the signature before the payload — a tampered-but-expired token reads bad_signature', () => {
    // A payload whose exp is in the past AND whose signature does not match must
    // surface the signature failure, never "expired": nothing is trusted first.
    const stale = { ...BASE, nonce: 'n', iat: 0, exp: 1 }
    const payloadB64 = Buffer.from(JSON.stringify(stale), 'utf8').toString('base64url')
    const wrongSig = Buffer.alloc(32, 7).toString('base64url')

    expect(verifyState(`${payloadB64}.${wrongSig}`)).toEqual({ ok: false, reason: 'bad_signature' })
  })
})
