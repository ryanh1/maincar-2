// oauthScopes.ts — the ONE place that knows which scopes Maincar asks for, what
// each one means in plain words, and how to weigh what was asked against what was
// granted. The whole amber state of the Integration Hub comes out of this file.
//
// The governing rule of this project: a partially-granted connection is NEVER
// shown as connected. Green means every requested permission is present. So the
// grant is EVALUATED, never assumed — the provider decides what it gave us, and it
// is routinely less than what was asked for. `evaluateGrant` makes that judgement
// honestly, and returns `limited` the moment a single requested scope is missing.
//
// No other file owns this copy. The scope strings, the human labels, and the
// provider labels all live here; `oauthProviders.ts` (IH-7) maps a provider to its
// HTTP client and imports the {@link Provider} type from here, so there is exactly
// one scope table and exactly one place that spells "Google".

/** The two providers Maincar integrates. The evaluable union other modules key off. */
export type Provider = 'google' | 'microsoft'

/** Which capability a scope unlocks. `identity` is "know which account this is". */
export type ScopeCapability = 'read' | 'send' | 'calendar' | 'identity'

/**
 * One requested scope, in full.
 *
 * - `param`        — the exact scope string sent in the authorize URL and compared,
 *                    verbatim, against what the provider reports it granted.
 * - `label`        — the plain-words permission shown to the rep on the card.
 * - `consequence`  — a verb phrase for what Maincar CANNOT do without it, used to
 *                    build `statusDetail`. Never a scope string.
 * - `capability`   — which of read / send / calendar / identity this unlocks.
 */
export interface RequiredScope {
  param: string
  label: string
  consequence: string
  capability: ScopeCapability
}

// The evaluable scopes, per provider, per the spec's § Scopes requested table
// (SPEC-int-oauth.md). Absence of any one of these is what turns a card amber.
export const REQUIRED_SCOPES: Record<Provider, readonly RequiredScope[]> = {
  google: [
    {
      param: 'https://www.googleapis.com/auth/gmail.readonly',
      label: 'Read your email',
      consequence: 'read your email',
      capability: 'read',
    },
    {
      param: 'https://www.googleapis.com/auth/gmail.send',
      label: 'Send email as you',
      consequence: 'send email as you',
      capability: 'send',
    },
    {
      param: 'https://www.googleapis.com/auth/calendar.events',
      label: 'See and add calendar events',
      consequence: 'see or add calendar events',
      capability: 'calendar',
    },
    {
      // Event access does not grant calendar inventory access. Calendar must be
      // able to show the calendars the connected account has actually shared.
      param: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      label: 'See your calendar list',
      consequence: 'see your calendar list',
      capability: 'calendar',
    },
    {
      // Free/busy has its own narrow Google consent scope. Do not substitute the
      // broader Calendar scope merely because event access is also requested.
      param: 'https://www.googleapis.com/auth/calendar.freebusy',
      label: 'See your availability',
      consequence: 'see your availability',
      capability: 'calendar',
    },
    {
      param: 'https://www.googleapis.com/auth/userinfo.email',
      label: 'Know which account this is',
      consequence: 'confirm which account this is',
      capability: 'identity',
    },
  ],
  microsoft: [
    {
      param: 'Mail.Read',
      label: 'Read your email',
      consequence: 'read your email',
      capability: 'read',
    },
    {
      param: 'Mail.Send',
      label: 'Send email as you',
      consequence: 'send email as you',
      capability: 'send',
    },
    {
      param: 'Calendars.ReadWrite',
      label: 'See and add calendar events',
      consequence: 'see or add calendar events',
      capability: 'calendar',
    },
    {
      param: 'User.Read',
      label: 'Know which account this is',
      consequence: 'confirm which account this is',
      capability: 'identity',
    },
  ],
}

// Scopes Maincar must REQUEST but does not evaluate for the amber state. Microsoft
// needs `offline_access` to be handed a refresh token at all — but the provider
// consumes it to mint that token rather than echoing it back in the granted-scope
// list, so evaluating it would make every Microsoft card read amber forever. The
// "can this grant outlive its first hour?" question is answered by the callback's
// `missing_refresh_token` path (IH-9), not by comparing scope strings here. Google
// gets its refresh token from `access_type=offline` + `prompt=consent`, so it
// needs no extra authorize-only scope.
const AUTHORIZE_ONLY_SCOPES: Record<Provider, readonly string[]> = {
  google: [],
  microsoft: ['offline_access'],
}

// The FULL product name, for the card title — the only place the provider is
// introduced. Buttons, toasts, and dialogs use the shorter `providerShortName`
// instead: "Connect Google" reads naturally, "Connect Google Workspace" does not.
const PROVIDER_LABELS: Record<Provider, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
}

/** The short name. The one place this copy lives. */
const PROVIDER_SHORT_NAMES: Record<Provider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
}

/** The result of weighing a grant. Mirrors the columns on {@link OAuthConnection}. */
export interface GrantEvaluation {
  /** `connected` only when nothing is missing; `limited` the instant one scope is. */
  status: 'connected' | 'limited'
  /** `null` when connected; `partial_access` when limited. */
  errorCode: 'partial_access' | null
  /** Empty when connected; one line naming the missing consequences when limited. */
  statusDetail: string
}

/**
 * Every scope string to put in the authorize URL for a provider — the evaluable
 * scopes plus the authorize-only ones. IH-7 builds its consent URL from this, so
 * the scope list is owned here and nowhere else.
 */
export function allRequestedScopes(provider: Provider): string[] {
  return [...REQUIRED_SCOPES[provider].map((s) => s.param), ...AUTHORIZE_ONLY_SCOPES[provider]]
}

/** The full product name, for the card title, e.g. `'Google Workspace'`. */
export function providerLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider]
}

/** The short name, for a button, toast, or dialog, e.g. `'Google'`. */
export function providerShortName(provider: Provider): string {
  return PROVIDER_SHORT_NAMES[provider]
}

/**
 * Weigh what the provider GRANTED against what Maincar requires.
 *
 * When every required scope is present the connection is `connected`, with no
 * error and an empty detail. When one or more is missing it is `limited` /
 * `partial_access`, and `statusDetail` names the CONSEQUENCE of each missing scope
 * in plain words — never the scope string. "gmail.send was not granted" tells a
 * rep nothing they can act on; "Maincar cannot send email as you" tells them
 * exactly what broke and, by omission, what still works.
 */
export function evaluateGrant(provider: Provider, granted: string[]): GrantEvaluation {
  const grantedSet = new Set(granted)
  const missing = REQUIRED_SCOPES[provider].filter((s) => !grantedSet.has(s.param))

  if (missing.length === 0) {
    return { status: 'connected', errorCode: null, statusDetail: '' }
  }

  return {
    status: 'limited',
    errorCode: 'partial_access',
    // The CONSEQUENCE, joined with "or", never the scope string. See the doc
    // comment above for why a scope name is useless to a rep.
    statusDetail: `Maincar cannot ${missing.map((s) => s.consequence).join(' or ')}.`,
  }
}

/**
 * The params of the scopes still missing from a grant — and only those. IH-9 feeds
 * these straight into an incremental re-consent (`mode: 'fix'`), so the rep is
 * asked for exactly what they refused and nothing they already allowed.
 */
export function missingScopeParams(provider: Provider, granted: string[]): string[] {
  const grantedSet = new Set(granted)
  return REQUIRED_SCOPES[provider].filter((s) => !grantedSet.has(s.param)).map((s) => s.param)
}
