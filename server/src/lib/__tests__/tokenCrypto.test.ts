import { describe, expect, it } from 'vitest'

import { decryptToken, encryptToken } from '../tokenCrypto.js'

const AAD = 'google:user_abc'

describe('tokenCrypto', () => {
  it('round-trips: decrypt(encrypt(x)) === x under the same AAD', () => {
    const secret = 'ya29.a0AfB_refresh-token-value'
    const sealed = encryptToken(secret, AAD)
    expect(decryptToken(sealed, AAD)).toBe(secret)
  })

  it('produces the versioned self-describing format v1.<iv>.<ct>.<tag>', () => {
    const sealed = encryptToken('anything', AAD)
    const parts = sealed.split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    // Every remaining part is non-empty base64url (no +, /, or = padding).
    for (const part of parts.slice(1)) {
      expect(part.length).toBeGreaterThan(0)
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('uses a fresh random IV per call — same plaintext encrypts differently', () => {
    const a = encryptToken('same-plaintext', AAD)
    const b = encryptToken('same-plaintext', AAD)
    expect(a).not.toBe(b)
    // The IV segment specifically must differ.
    expect(a.split('.')[1]).not.toBe(b.split('.')[1])
  })

  it('throws on the wrong AAD — a row copied to another user cannot be read', () => {
    // This is the test that proves the binding is real rather than decorative:
    // the key is identical, only the AAD differs.
    const sealed = encryptToken('secret', 'google:user_abc')
    expect(() => decryptToken(sealed, 'google:user_xyz')).toThrow()
  })

  it('throws on a tampered auth tag', () => {
    const [v, iv, ct] = encryptToken('secret', AAD).split('.')
    const forgedTag = Buffer.alloc(16, 0).toString('base64url')
    expect(() => decryptToken(`${v}.${iv}.${ct}.${forgedTag}`, AAD)).toThrow()
  })

  it('throws on tampered ciphertext', () => {
    const parts = encryptToken('secret', AAD).split('.')
    const body = Buffer.from(parts[2], 'base64url')
    body[0] ^= 0xff
    parts[2] = body.toString('base64url')
    expect(() => decryptToken(parts.join('.'), AAD)).toThrow()
  })

  it('throws on an unknown version prefix', () => {
    const sealed = encryptToken('secret', AAD)
    const forged = `v2${sealed.slice(2)}`
    expect(() => decryptToken(forged, AAD)).toThrow(/unknown ciphertext version/)
  })

  it('throws on a malformed shape (wrong number of segments)', () => {
    expect(() => decryptToken('v1.only.three', AAD)).toThrow(/malformed/)
  })
})
