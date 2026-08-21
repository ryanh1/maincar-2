/**
 * Where to land after signing in, when something sent the person to the sign-in
 * screen and wants them back afterwards (an invite link, a protected route).
 *
 * Only a same-site path is ever honoured. `//evil.test` and `https://evil.test`
 * are both absolute URLs to a browser, so an unchecked value here would turn the
 * sign-in screen into an open redirect.
 */
export interface SignInHandoff {
  /** Absolute path within this app, e.g. `/join/abc123`. */
  from?: string
  /** Address to prefill, so the person does not have to retype it. */
  email?: string
}

export function safeRedirect(from: unknown, fallback: string): string {
  if (typeof from !== 'string') return fallback
  if (!from.startsWith('/') || from.startsWith('//')) return fallback
  return from
}

export function readHandoff(state: unknown): SignInHandoff {
  if (typeof state !== 'object' || state === null) return {}
  const { from, email } = state as Record<string, unknown>
  return {
    from: typeof from === 'string' ? from : undefined,
    email: typeof email === 'string' ? email : undefined,
  }
}
