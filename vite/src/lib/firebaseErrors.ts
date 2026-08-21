/**
 * One short, actionable line for every way signing in or signing up can fail.
 *
 * Three kinds of failure arrive here and they must never be confused:
 *
 *   1. Wrong details      — the person can fix it by typing something else.
 *   2. Nothing is reachable — Firebase or our API is down or the network dropped.
 *      This must read "try again in a moment", never "your details are wrong",
 *      and it must never sign anybody out.
 *   3. Rate limited       — right details, too fast. Waiting is the fix.
 *
 * `screen` exists for ONE reason: the sign-in screen must not become an account
 * oracle. `auth/user-not-found` and `auth/wrong-password` are the same sentence
 * there, so a stranger cannot use the form to learn whether an address has an
 * account. Sign-up is different and deliberately so — "that email already has an
 * account" is unavoidable (the create would fail anyway) and it is the only
 * message that tells the reader what to do next.
 */
import { ApiError } from '@/lib/api'
import { PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy'

export type AuthScreen = 'signIn' | 'signUp'

/** Matches `respondFirebaseUnreachable` on the server (503), and a dead network. */
export const SERVICE_UNREACHABLE = 'Cannot reach the sign-in service. Try again in a moment.'

/**
 * The single answer for every wrong-credentials shape on the sign-in screen.
 * Deliberately says nothing about which half was wrong.
 */
export const CREDENTIALS_DO_NOT_MATCH = 'That email and password did not match. Check both and try again.'

const GENERIC = 'Something went wrong. Try again.'

/** Firebase throws plain objects in some paths, so read `code` rather than instanceof. */
export function firebaseErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/** True when nothing could be reached, so the copy must say "try again", not "wrong". */
export function isUnreachable(error: unknown): boolean {
  // 502/503/504 are "nothing answered" — our own `respondFirebaseUnreachable`
  // sends 503. A 500 is code that broke after answering, which is a different
  // sentence: waiting will not fix it.
  if (error instanceof ApiError) return error.status >= 502 && error.status <= 504
  const code = firebaseErrorCode(error)
  if (code === 'auth/network-request-failed' || code === 'auth/internal-error') return true
  // `fetch` rejects with a TypeError when the connection never opened.
  return error instanceof TypeError
}

export function authErrorToMessage(error: unknown, screen: AuthScreen): string {
  if (isUnreachable(error)) return SERVICE_UNREACHABLE

  // Our own API. 4xx carries a message written for a person; 5xx never does.
  if (error instanceof ApiError) return error.status < 500 ? error.message : GENERIC

  switch (firebaseErrorCode(error)) {
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.'
    case 'auth/invalid-email':
      // A format check that runs before any lookup, so it discloses nothing.
      return 'Enter a valid email address.'
    case 'auth/missing-password':
      return 'Enter your password.'
    case 'auth/user-disabled':
      return 'That account is turned off. Ask an admin to turn it back on.'
    case 'auth/weak-password':
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
    case 'auth/email-already-in-use':
      return screen === 'signUp'
        ? 'That email already has an account. Sign in instead.'
        : CREDENTIALS_DO_NOT_MATCH
    // Newer Firebase versions already collapse the first two into
    // `auth/invalid-credential`; older ones and the emulator do not.
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return CREDENTIALS_DO_NOT_MATCH
    default:
      return GENERIC
  }
}
