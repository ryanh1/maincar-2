import crypto from 'node:crypto'

import { TOKEN_ENC_KEY } from '../config.js'

// AES-256-GCM encryption of OAuth grants at rest. The stored format is
// self-describing and versioned:
//
//     v1.<iv>.<ciphertext>.<tag>     (every part base64url)
//
// The version prefix is what makes key rotation ADDITIVE rather than a migration:
// a new key ships as `v2` with its own branch in decryptToken, and existing `v1`
// rows keep decrypting under the old key. Nothing ever rewrites stored ciphertext.
const VERSION = 'v1'

// GCM's authentication tag is 128 bits.
const TAG_BYTES = 16
// A 96-bit IV is the GCM recommendation; we generate a fresh one per call.
const IV_BYTES = 12

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/**
 * Encrypt `plaintext` and bind the ciphertext to `aad` (Additional Authenticated
 * Data — for OAuth grants this is `${provider}:${userId}`). The AAD is
 * authenticated but not stored: decryption must be handed the SAME aad, so a row
 * copied onto another user's connection fails to decrypt even with the master key.
 *
 * The IV is 12 random bytes per call — never reused, never derived from the
 * plaintext or the key — which is what keeps GCM secure across many encryptions.
 */
export function encryptToken(plaintext: string, aad: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_ENC_KEY, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}.${b64url(iv)}.${b64url(body)}.${b64url(tag)}`
}

/**
 * Decrypt a value produced by {@link encryptToken}, using the same `aad`.
 *
 * Throws — never returns a partial or empty result — on any of: an unknown
 * version prefix, a malformed shape, a wrong AAD, a wrong key, or a tampered
 * ciphertext or tag. GCM verifies the tag in `final()`, so all tampering and
 * every AAD mismatch surfaces as a thrown error, which callers must treat as
 * `token_unreadable` rather than as an absent token.
 */
export function decryptToken(value: string, aad: string): string {
  const parts = value.split('.')
  if (parts.length !== 4) {
    throw new Error('tokenCrypto: malformed ciphertext (expected v1.<iv>.<ciphertext>.<tag>)')
  }
  const [version, ivB64, bodyB64, tagB64] = parts
  if (version !== VERSION) {
    throw new Error(`tokenCrypto: unknown ciphertext version "${version}"`)
  }

  const iv = Buffer.from(ivB64, 'base64url')
  const body = Buffer.from(bodyB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('tokenCrypto: malformed ciphertext (bad iv or tag length)')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_ENC_KEY, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
