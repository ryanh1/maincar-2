import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import {
  CREDENTIALS_DO_NOT_MATCH,
  SERVICE_UNREACHABLE,
  authErrorToMessage,
  isUnreachable,
} from '@/lib/firebaseErrors'
import { PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy'

const err = (code: string) => ({ code, message: code })

describe('authErrorToMessage', () => {
  it('gives each code its own actionable line', () => {
    expect(authErrorToMessage(err('auth/email-already-in-use'), 'signUp')).toBe(
      'That email already has an account. Sign in instead.',
    )
    expect(authErrorToMessage(err('auth/weak-password'), 'signUp')).toBe(
      `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
    expect(authErrorToMessage(err('auth/too-many-requests'), 'signIn')).toBe(
      'Too many attempts. Wait a minute and try again.',
    )
    expect(authErrorToMessage(err('auth/invalid-email'), 'signIn')).toBe('Enter a valid email address.')
    expect(authErrorToMessage(err('auth/network-request-failed'), 'signIn')).toBe(SERVICE_UNREACHABLE)
    expect(authErrorToMessage(err('auth/user-disabled'), 'signIn')).toBe(
      'That account is turned off. Ask an admin to turn it back on.',
    )
  })

  // The security property. Telling these apart turns the sign-in form into a
  // lookup service for "does this address have an account here".
  it('says the SAME thing for every wrong-credentials shape on sign-in', () => {
    const codes = [
      'auth/user-not-found',
      'auth/wrong-password',
      'auth/invalid-credential',
      'auth/invalid-login-credentials',
    ]
    const messages = codes.map((c) => authErrorToMessage(err(c), 'signIn'))

    expect(new Set(messages).size).toBe(1)
    expect(messages[0]).toBe(CREDENTIALS_DO_NOT_MATCH)
    // And it names neither half as the wrong one.
    expect(messages[0]).not.toMatch(/password is|no account|not found|incorrect password/i)
  })

  it('will not disclose an existing account through the sign-in screen', () => {
    expect(authErrorToMessage(err('auth/email-already-in-use'), 'signIn')).toBe(CREDENTIALS_DO_NOT_MATCH)
  })

  it('reads a transport failure as "try again", never as wrong details', () => {
    // The 503 our own API returns when it cannot reach Firebase.
    expect(authErrorToMessage(new ApiError('Cannot reach the sign-in service.', 503), 'signIn')).toBe(
      SERVICE_UNREACHABLE,
    )
    // fetch rejects with a TypeError when the connection never opened.
    expect(authErrorToMessage(new TypeError('Failed to fetch'), 'signIn')).toBe(SERVICE_UNREACHABLE)
    expect(isUnreachable(new ApiError('down', 503))).toBe(true)
    expect(isUnreachable(new ApiError('gone', 404))).toBe(false)
    // A 500 answered — it just answered badly. Waiting does not fix that.
    expect(isUnreachable(new ApiError('boom', 500))).toBe(false)
  })

  it('passes a 4xx from our own API through, and hides a 5xx', () => {
    expect(authErrorToMessage(new ApiError('Too many attempts. Wait a minute and try again.', 429), 'signIn')).toBe(
      'Too many attempts. Wait a minute and try again.',
    )
    expect(authErrorToMessage(new ApiError('TypeError: prisma is undefined', 500), 'signIn')).toBe(
      'Something went wrong. Try again.',
    )
  })

  it('falls back rather than showing a raw code', () => {
    expect(authErrorToMessage(err('auth/some-code-we-never-saw'), 'signIn')).toBe('Something went wrong. Try again.')
    expect(authErrorToMessage('a string', 'signIn')).toBe('Something went wrong. Try again.')
  })
})
