// connectionTest.test.ts — the three per-capability probes (IH-18).
//
// What these protect:
//   - Test returns a verdict PER capability (read / send / calendar), never a
//     single boolean — a rep learns WHICH permission is broken.
//   - the probes are read-only: `sendEmail` and `createEvent` are never called, no
//     matter the outcome.
//   - send is judged from the granted scope, so a missing `gmail.send` reads red
//     with "permission not granted" while read and calendar stay green — one broken
//     capability never poisons the other two.
//   - a hung provider becomes `provider_unreachable` at 10s; a revoked token becomes
//     `token_revoked` WITHOUT the call throwing.
//   - `label` is the exact plain-words string `REQUIRED_SCOPES` gives the card.
//
// No test reaches a provider. The `MailProvider` is a fake with `vi.fn` methods, so
// every line of `testConnection` runs for real against controllable round-trips.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { testConnection } from '../connectionTest.js'
import type { MailProvider } from '../MailProvider.js'
import { MailAuthError } from '../mailErrors.js'
import { TokenRevokedError, TokenUnreadableError } from '../oauthConnections.js'
import { REQUIRED_SCOPES, type Provider } from '../../oauthScopes.js'

/** Every scope Google grants a fully-connected mailbox. */
const GOOGLE_ALL_SCOPES = REQUIRED_SCOPES.google.map((s) => s.param)

const sendParam = (provider: Provider) =>
  REQUIRED_SCOPES[provider].find((s) => s.capability === 'send')!.param

const labelFor = (provider: Provider, capability: 'read' | 'send' | 'calendar') =>
  REQUIRED_SCOPES[provider].find((s) => s.capability === capability)!.label

/**
 * A fake MailProvider. `listMessagesSince` / `listEventsSince` behave as the test
 * dictates; `sendEmail` / `createEvent` are spies that MUST stay uncalled — probing
 * is read-only.
 */
function fakeProvider(
  provider: Provider,
  read: () => Promise<unknown>,
  calendar: () => Promise<unknown> = read,
): MailProvider {
  return {
    provider,
    sendEmail: vi.fn(async () => {
      throw new Error('sendEmail must never be called by a probe')
    }),
    listMessagesSince: vi.fn(async () => {
      await read()
      return { messages: [], nextCursor: null }
    }),
    getMessage: vi.fn(async () => {
      throw new Error('getMessage is not part of any probe')
    }),
    listEventsSince: vi.fn(async () => {
      await calendar()
      return { events: [], nextCursor: null }
    }),
    createEvent: vi.fn(async () => {
      throw new Error('createEvent must never be called by a probe')
    }),
  } as unknown as MailProvider
}

const ok = async () => undefined

const byCapability = (results: Awaited<ReturnType<typeof testConnection>>) =>
  Object.fromEntries(results.map((r) => [r.capability, r]))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('testConnection — per-capability probes', () => {
  it('a full grant returns three green capabilities', async () => {
    const provider = fakeProvider('google', ok)

    const results = await testConnection(provider, GOOGLE_ALL_SCOPES)
    const byCap = byCapability(results)

    expect(results).toHaveLength(3)
    expect(byCap.read_email.ok).toBe(true)
    expect(byCap.send_email.ok).toBe(true)
    expect(byCap.calendar.ok).toBe(true)
    // Green carries no reason and no error code.
    for (const r of results) {
      expect(r.reason).toBe('')
      expect(r.errorCode).toBeNull()
    }
  })

  it('labels are the SAME plain-words strings REQUIRED_SCOPES gives the card', async () => {
    const provider = fakeProvider('google', ok)

    const byCap = byCapability(await testConnection(provider, GOOGLE_ALL_SCOPES))

    expect(byCap.read_email.label).toBe(labelFor('google', 'read'))
    expect(byCap.send_email.label).toBe(labelFor('google', 'send'))
    expect(byCap.calendar.label).toBe(labelFor('google', 'calendar'))
  })

  it('a missing gmail.send scope: read and calendar green, send red — one failure does not hide the others', async () => {
    const provider = fakeProvider('google', ok)
    const withoutSend = GOOGLE_ALL_SCOPES.filter((s) => s !== sendParam('google'))

    const byCap = byCapability(await testConnection(provider, withoutSend))

    expect(byCap.read_email.ok).toBe(true)
    expect(byCap.calendar.ok).toBe(true)

    expect(byCap.send_email.ok).toBe(false)
    expect(byCap.send_email.errorCode).toBe('partial_access')
    // The reason says the permission is missing — never that a test message failed.
    expect(byCap.send_email.reason).toMatch(/not granted/i)
    expect(byCap.send_email.reason).not.toMatch(/message|failed to send|test message/i)
  })

  it('never sends an email and never creates an event, whatever the outcome', async () => {
    const provider = fakeProvider('google', ok)
    // Even a mailbox missing the send scope must not trigger a send-attempt.
    const withoutSend = GOOGLE_ALL_SCOPES.filter((s) => s !== sendParam('google'))

    await testConnection(provider, GOOGLE_ALL_SCOPES)
    await testConnection(provider, withoutSend)

    expect(provider.sendEmail).not.toHaveBeenCalled()
    expect(provider.createEvent).not.toHaveBeenCalled()
  })

  it('a revoked token reads token_revoked on every live probe, without throwing', async () => {
    const revoked = async () => {
      throw new MailAuthError()
    }
    const provider = fakeProvider('google', revoked)

    // The call resolves — a broken integration is an expected state, not a throw.
    const byCap = byCapability(await testConnection(provider, GOOGLE_ALL_SCOPES))

    expect(byCap.read_email.ok).toBe(false)
    expect(byCap.read_email.errorCode).toBe('token_revoked')
    // Send: scope IS granted, so it makes the live liveness read, which is revoked too.
    expect(byCap.send_email.ok).toBe(false)
    expect(byCap.send_email.errorCode).toBe('token_revoked')
    expect(byCap.calendar.ok).toBe(false)
    expect(byCap.calendar.errorCode).toBe('token_revoked')

    // Still read-only, even on the failure path.
    expect(provider.sendEmail).not.toHaveBeenCalled()
    expect(provider.createEvent).not.toHaveBeenCalled()
  })

  it("a probe whose own token refresh cannot be refreshed reads token_revoked, not unknown", async () => {
    // withFreshAccessToken throws this when the refresh token itself is revoked — the
    // "token cannot be refreshed" case. classify must not bury it under `unknown`.
    const revoked = async () => {
      throw new TokenRevokedError()
    }
    const byCap = byCapability(await testConnection(fakeProvider('google', revoked), GOOGLE_ALL_SCOPES))

    expect(byCap.read_email.errorCode).toBe('token_revoked')
    expect(byCap.calendar.errorCode).toBe('token_revoked')
  })

  it('a probe whose stored credentials will not decrypt reads token_unreadable', async () => {
    const unreadable = async () => {
      throw new TokenUnreadableError()
    }
    const byCap = byCapability(await testConnection(fakeProvider('google', unreadable), GOOGLE_ALL_SCOPES))

    expect(byCap.read_email.ok).toBe(false)
    expect(byCap.read_email.errorCode).toBe('token_unreadable')
  })

  it('a provider that hangs past 10s reads provider_unreachable', async () => {
    vi.useFakeTimers()
    const hang = () => new Promise<never>(() => {}) // never settles
    const provider = fakeProvider('google', hang)

    const pending = testConnection(provider, GOOGLE_ALL_SCOPES)
    // Advance past the 10s probe timeout so every hung probe rejects.
    await vi.advanceTimersByTimeAsync(10_000)
    const byCap = byCapability(await pending)

    expect(byCap.read_email.errorCode).toBe('provider_unreachable')
    expect(byCap.send_email.errorCode).toBe('provider_unreachable')
    expect(byCap.calendar.errorCode).toBe('provider_unreachable')
    for (const cap of ['read_email', 'send_email', 'calendar'] as const) {
      expect(byCap[cap].ok).toBe(false)
    }
  })

  it('works for Microsoft too, using Microsoft scope strings and labels', async () => {
    const provider = fakeProvider('microsoft', ok)
    const allScopes = REQUIRED_SCOPES.microsoft.map((s) => s.param)

    const byCap = byCapability(await testConnection(provider, allScopes))

    expect(byCap.send_email.ok).toBe(true)
    expect(byCap.send_email.label).toBe(labelFor('microsoft', 'send'))

    // Drop Mail.Send → send red, read and calendar green.
    const withoutSend = allScopes.filter((s) => s !== sendParam('microsoft'))
    const dropped = byCapability(await testConnection(provider, withoutSend))
    expect(dropped.read_email.ok).toBe(true)
    expect(dropped.calendar.ok).toBe(true)
    expect(dropped.send_email.ok).toBe(false)
    expect(dropped.send_email.errorCode).toBe('partial_access')
  })
})
