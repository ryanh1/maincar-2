// connectionTest.ts — the three per-capability probes behind the Test button
// (SPEC-int-health.md § The probes, IH-18).
//
// `testConnection` answers one question per capability — read, send, calendar —
// so a rep learns WHICH permission is broken, never just that "something" is. It
// returns a `CapabilityResult[]`, never a single boolean: a bare pass/fail would
// collapse "send is revoked" and "calendar is unreachable" into the same useless
// red, and the rep would have nothing to act on.
//
// READ-ONLY BY CONSTRUCTION. Every probe calls a read method on the seam and
// nothing else. Nothing here calls `sendEmail` and nothing calls `createEvent`;
// proving "can send" by sending a real email, or "can add events" by creating a
// real event, would leave litter in a rep's mailbox and calendar every time they
// click Test. Send has no free read-only probe on either provider, so it is judged
// from the GRANTED SCOPE plus a live identity/liveness read — and its `reason` says
// the permission is missing, never that a test message failed, because none is sent.
//
// The verdict PER CAPABILITY carries its own `errorCode` from the one stable table
// (integrationErrors.ts). IH-19's route aggregates these into the connection's
// written-back status; this file only reads and reports, it writes no row.

import type { MailProvider } from './MailProvider.js'
import { MailAuthError, RateLimitedError } from './mailErrors.js'
import { TokenRevokedError, TokenUnreadableError } from './oauthConnections.js'
import type { IntegrationErrorCode } from './integrationErrors.js'
import {
  REQUIRED_SCOPES,
  type Provider,
  type RequiredScope,
  type ScopeCapability,
} from '../oauthScopes.js'

/** The three capabilities a connection is probed for. Never collapsed to a boolean. */
export type Capability = 'read_email' | 'send_email' | 'calendar'

/**
 * One capability's verdict.
 *
 * - `label`     — the SAME plain-words permission name `REQUIRED_SCOPES` gives the
 *                 card, so the Test result and the card say the same thing.
 * - `ok`        — did this one capability check out, independently of the others.
 * - `reason`    — why not, in plain words. Empty string when `ok`.
 * - `errorCode` — the stable machine code for the failure, `null` when `ok`. IH-19
 *                 aggregates these into the connection's written-back status.
 */
export interface CapabilityResult {
  capability: Capability
  label: string
  ok: boolean
  reason: string
  errorCode: IntegrationErrorCode | null
}

/** No probe may hang the Test past this. A slower provider is `provider_unreachable`. */
const PROBE_TIMEOUT_MS = 10_000

/**
 * A probe exceeded {@link PROBE_TIMEOUT_MS}. Its own class so `classify` can tell a
 * timeout apart from a provider error and map only it to `provider_unreachable`.
 */
class ProbeTimeoutError extends Error {
  constructor() {
    super('The provider did not respond within the probe timeout.')
    this.name = 'ProbeTimeoutError'
  }
}

/**
 * The send scope was not in the grant. Thrown BEFORE any live call, because a
 * missing permission is a determinate red that needs no round-trip — and proves
 * itself without sending anything. Carries the scope's `consequence` so the reason
 * names what Maincar cannot do, not the scope string.
 */
class ScopeNotGrantedError extends Error {
  readonly consequence: string
  constructor(consequence: string) {
    super('The required scope was not granted.')
    this.name = 'ScopeNotGrantedError'
    this.consequence = consequence
  }
}

/** Reject with {@link ProbeTimeoutError} if `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeoutError()), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** The single probe per capability. Read-only: it calls a read method and nothing else. */
interface CapabilitySpec {
  id: Capability
  /** Which `REQUIRED_SCOPES` entry names this capability's label and consequence. */
  scope: ScopeCapability
  /** The live, read-only round-trip that proves the capability. Resolves = ok. */
  probe: (provider: MailProvider, granted: ReadonlySet<string>) => Promise<void>
}

/** The send scope's `param` for a provider, e.g. `gmail.send` / `Mail.Send`. */
function sendScopeParam(provider: Provider): string {
  return required(provider, 'send').param
}

/** The `REQUIRED_SCOPES` entry for a capability. There is always exactly one. */
function required(provider: Provider, capability: ScopeCapability): RequiredScope {
  const scope = REQUIRED_SCOPES[provider].find((s) => s.capability === capability)
  // Every provider defines read/send/calendar/identity, so this is a programmer
  // error (a scope table gap), not a runtime condition — fail loud.
  if (!scope) throw new Error(`No ${capability} scope defined for provider "${provider}".`)
  return scope
}

const CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: 'read_email',
    scope: 'read',
    // Cheapest possible read: one message. We never look at the body.
    probe: async (provider) => {
      await provider.listMessagesSince(null, 1)
    },
  },
  {
    id: 'send_email',
    scope: 'send',
    // Send has NO free read-only probe on either provider, so it is judged from the
    // granted scope PLUS a live liveness read that proves the token still works —
    // never by sending a test message. Missing scope short-circuits to red before
    // any round-trip, so the reason is honestly "permission not granted".
    probe: async (provider, granted) => {
      if (!granted.has(sendScopeParam(provider.provider))) {
        throw new ScopeNotGrantedError(required(provider.provider, 'send').consequence)
      }
      await provider.listMessagesSince(null, 1)
    },
  },
  {
    id: 'calendar',
    scope: 'calendar',
    probe: async (provider) => {
      await provider.listEventsSince(null, 1)
    },
  },
]

/** Map a probe failure onto the one stable error-code table. */
function classify(err: unknown): IntegrationErrorCode {
  if (err instanceof ProbeTimeoutError) return 'provider_unreachable'
  // A 401 that survived a fresh token means the grant itself is dead, not a blip.
  if (err instanceof MailAuthError) return 'token_revoked'
  // A probe's own token refresh can fail terminally: the refresh token was revoked
  // (the "token cannot be refreshed" case), or the stored ciphertext will not decrypt.
  // Both are dead grants, not transient — surface the same code the refresh path stamps
  // rather than burying them under `unknown`.
  if (err instanceof TokenRevokedError) return 'token_revoked'
  if (err instanceof TokenUnreadableError) return 'token_unreadable'
  // Rate limiting is transient — the same "try again later" the rep gets for a
  // network failure, so it shares the code rather than inventing a new one.
  if (err instanceof RateLimitedError) return 'provider_unreachable'
  return 'unknown'
}

/** Plain-words reason for a live failure, phrased around what Maincar cannot do. */
function reasonForFailure(code: IntegrationErrorCode, consequence: string): string {
  switch (code) {
    case 'provider_unreachable':
      return `The provider did not respond, so Maincar could not confirm it can ${consequence}. Try again shortly.`
    case 'token_revoked':
      return `The mailbox rejected the saved access, so Maincar can no longer ${consequence}. Reconnect to restore it.`
    case 'token_unreadable':
      return `Maincar could not read the saved mailbox credentials, so it can no longer ${consequence}. Reconnect to restore it.`
    default:
      return `The provider returned an unexpected error, so Maincar could not confirm it can ${consequence}.`
  }
}

/**
 * Probe every capability of a connected mailbox and return a verdict for each.
 *
 * @param provider - the resolved seam for this mailbox (from `getMailProvider`).
 * @param grantedScopes - the scope strings the provider reports it granted. The
 *   send verdict reads this; read and calendar are proved purely by a live call.
 *
 * Read-only: the only provider methods called are `listMessagesSince` and
 * `listEventsSince`. `sendEmail` and `createEvent` are never called.
 */
export async function testConnection(
  provider: MailProvider,
  grantedScopes: string[],
): Promise<CapabilityResult[]> {
  const granted = new Set(grantedScopes)
  const providerId = provider.provider

  // Promise.all, NOT one try/catch wrapped around all three probes: a single
  // try/catch would let the first failure reject the whole batch and hide the
  // verdict on the other two capabilities. Each probe owns its own try/catch so
  // one broken permission never masks the two that still work — which is the whole
  // reason this returns an array and not a boolean.
  return Promise.all(
    CAPABILITIES.map(async (cap): Promise<CapabilityResult> => {
      const scope = required(providerId, cap.scope)
      try {
        await withTimeout(cap.probe(provider, granted), PROBE_TIMEOUT_MS)
        return { capability: cap.id, label: scope.label, ok: true, reason: '', errorCode: null }
      } catch (err) {
        if (err instanceof ScopeNotGrantedError) {
          // A withheld permission, proved without a round-trip. `partial_access` is
          // the same code `evaluateGrant` stamps a missing scope with.
          return {
            capability: cap.id,
            label: scope.label,
            ok: false,
            reason: `Permission to ${err.consequence} was not granted.`,
            errorCode: 'partial_access',
          }
        }
        const code = classify(err)
        return {
          capability: cap.id,
          label: scope.label,
          ok: false,
          reason: reasonForFailure(code, scope.consequence),
          errorCode: code,
        }
      }
    }),
  )
}
