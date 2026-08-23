/**
 * The Integration Hub's server routes: the two authenticated ones a rep's Settings
 * page reads and clicks. `POST …/authorize` mints the consent URL; `GET …` lists one
 * card per provider so the page renders both without owning the provider list.
 *
 * Why these two live under `/api/integrations/orgs/:orgId/…` and the callback does
 * not:
 *   - A rep starts consent while signed in, so the org is in the path and membership
 *     is re-proven from it on every request (server/src/lib/membership.ts). Nothing
 *     here trusts the caller's `currentOrgId` — a preference the client can set —
 *     to decide which tenant's connections a request touches.
 *   - The provider then redirects the rep back to `GET /api/integrations/:provider/
 *     callback`, which carries NO session and cannot be org-scoped: it is reached by
 *     a browser navigation from Google/Microsoft, not by an authenticated fetch. The
 *     signed `state` minted here is what says whose consent it is, so the callback
 *     needs neither a path org nor `requireAuth`. That route is the ONLY unauthenticated
 *     one in this module and lands in a later ticket (IH-10, MAI-107); it will mount
 *     separately in app.ts because it is not under `/orgs/:orgId`.
 *
 * PKCE is stateless here on purpose. The authorize route needs a code challenge, and
 * the callback needs the matching verifier, but the two requests share no session and
 * we keep no server-side store. Both derive the verifier from the signed `state` with
 * an HMAC keyed by a server secret ({@link pkceVerifierForState}): the callback
 * re-derives it after it verifies the state, and an attacker who intercepts the
 * redirect (code + state) cannot — the secret never leaves the server, and only the
 * S256 challenge is ever put in a URL.
 */
import crypto from 'node:crypto'

import { Router } from 'express'
import { z } from 'zod'

import { APP_NAME, OAUTH_STATE_SECRET, WEB_ORIGIN } from '../config.js'
import prisma from '../db.js'
import { logger } from '../../dependencies/logger.js'
import { OAuthProviderError } from '../../dependencies/oauthTypes.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { listBrokenConnections } from '../lib/mail/connectionHealth.js'
import { testConnection, type CapabilityResult } from '../lib/mail/connectionTest.js'
import { getMailProvider } from '../lib/mail/getMailProvider.js'
import { queueMailBackfillForConnection } from '../jobs/mailBackfill.js'
import { mapProviderError, type IntegrationErrorCode } from '../lib/mail/integrationErrors.js'
import {
  CONNECTION_PUBLIC_SELECT,
  disconnectConnection,
  getConnection,
  markConnectionError,
  refreshConnection,
  saveConnection,
  serializeConnection,
  TokenRevokedError,
  TokenUnreadableError,
  type SerializedConnection,
} from '../lib/mail/oauthConnections.js'
import { isProvider, oauthClientFor, PROVIDERS } from '../lib/mail/oauthProviders.js'
import { requireMembership } from '../lib/membership.js'
import {
  allRequestedScopes,
  missingScopeParams,
  providerLabel,
  providerShortName,
  REQUIRED_SCOPES,
  type Provider,
} from '../lib/oauthScopes.js'
import { signState, verifyState, type StatePayload } from '../lib/oauthState.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

// mergeParams so `:orgId` from the mount path (/api/integrations/orgs/:orgId) reaches
// req.params here — without it the tenant id the whole file depends on would be
// undefined and every membership check would silently fail open.
const router = Router({ mergeParams: true })

router.use(requireAuth)

/** The card the hub renders per provider. One per PROVIDER, never per connection. */
interface IntegrationCard {
  provider: Provider
  /** The full product name ("Google Workspace"), for the card title only. */
  providerLabel: string
  /** The short name ("Google"), for buttons, toasts, and the disconnect dialog. */
  providerShortName: string
  /** The plain-words permissions Maincar asks for, shown on the card. */
  requiredPermissions: string[]
  /** The rep's connection for this provider, token-free — or null when none exists. */
  connection: SerializedConnection | null
  /** Every connection for this provider, oldest first. */
  connections: SerializedConnection[]
}

// The authorize body. `mode: 'fix'` is incremental re-consent and must name a
// connection. `mode: 'connect'` asks for all scopes; it may name an existing
// connection for a targeted reconnect or omit it when adding another account.
const authorizeBody = z.object({
  mode: z.enum(['connect', 'fix']),
  connectionId: z.string().min(1).optional(),
})

/**
 * The PKCE verifier for a signed `state`. Derived, not stored: HMAC-SHA256 over the
 * state string with the server secret, base64url-encoded (32 bytes → 43 chars, inside
 * PKCE's 43–128 range and all unreserved characters). Exported so the callback (IH-10)
 * re-derives the SAME verifier from the same state it just verified, with no store to
 * keep in sync. The domain-separation prefix keeps this HMAC from colliding with the
 * state signature, which is taken over the payload segment with the same secret.
 */
export function pkceVerifierForState(state: string): string {
  return crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(`pkce:v1:${state}`).digest('base64url')
}

/** The S256 challenge for a state's verifier — the only half of PKCE that reaches a URL. */
function pkceChallengeForState(state: string): string {
  const verifier = pkceVerifierForState(state)
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// ============================================================
// POST /api/integrations/orgs/:orgId/:provider/authorize — start consent
// ============================================================
// Returns a consent URL; it NEVER redirects — the client opens it in a popup it
// already has. `mode: 'connect'` asks for the full scope set; `mode: 'fix'` asks for
// only the scopes a partial grant is missing and pre-fills the existing address, so
// the rep re-approves nothing they already allowed.
router.post(
  '/:provider/authorize',
  wrapRoute('POST /api/integrations/orgs/:orgId/:provider/authorize', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Re-proven from the path. A non-member (or a disabled org) is 404, never a 403
    // that would confirm the org exists (server/src/lib/membership.ts).
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Parse & validate params ---
    // The `:provider` param is attacker-controlled, so it is narrowed before it keys
    // the registry or the scope table. An unknown provider is a 404, never a crash.
    const providerParam = String(req.params.provider)
    if (!isProvider(providerParam)) {
      return void res.status(404).json({ error: 'Unknown provider' })
    }
    const provider: Provider = providerParam

    const parsed = authorizeBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Provide a valid mode.' })
    }
    const { mode } = parsed.data

    // --- Build the scope request ---
    let scopes: string[]
    let loginHint: string | undefined
    let connectionId: string | null = null

    if (mode === 'fix' && !parsed.data.connectionId) {
      return void res.status(400).json({ error: 'A repair needs a connectionId.' })
    }

    if (parsed.data.connectionId) {
      // Scoped to (id, orgId, userId, provider): another rep's connection — or one
      // for a different provider — is simply not found, and the answer is 404. A
      // mailbox belongs to a rep, so userId is part of the boundary, not just orgId.
      const connection = await prisma.oAuthConnection.findFirst({
        where: { id: parsed.data.connectionId, orgId, userId, provider },
        select: { id: true, emailAddress: true, scopes: true },
      })
      if (!connection) {
        return void res.status(404).json({ error: 'Connection not found' })
      }

      if (mode === 'fix') {
        const missing = missingScopeParams(provider, connection.scopes)
        if (missing.length === 0) {
          // Nothing is missing, so there is nothing to re-consent to. Building a URL
          // with an empty scope set would be rejected by the provider anyway.
          return void res.status(400).json({ error: 'This connection has every permission already.' })
        }
        scopes = missing
      } else {
        scopes = allRequestedScopes(provider)
      }
      loginHint = connection.emailAddress
      connectionId = connection.id
    } else {
      scopes = allRequestedScopes(provider)
    }

    // --- Build the consent URL ---
    // The nonce, iat and exp are minted inside signState; the caller cannot forge
    // them. The PKCE challenge is derived from the signed state so the callback can
    // re-derive the verifier without a store.
    const state = signState({ provider, userId, orgId, mode, connectionId })
    const url = oauthClientFor(provider).buildAuthorizeUrl({
      scopes,
      state,
      codeChallenge: pkceChallengeForState(state),
      loginHint,
    })

    // --- Return response ---
    res.json({ url })
  }),
)

// ============================================================
// GET /api/integrations/orgs/:orgId — the hub's cards
// ============================================================
// One entry per PROVIDER, not per connection, so the client renders both cards
// without owning the provider list or the permission copy. A provider the rep has
// not connected has `connection: null`, which the card renders as "Not connected".
router.get(
  '/',
  wrapRoute('GET /api/integrations/orgs/:orgId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute query ---
    // This rep's connections, in this org, in the token-free public shape. A mailbox
    // belongs to a rep (orgId, userId); multiple provider identities may coexist.
    const rows = await prisma.oAuthConnection.findMany({
      where: { orgId, userId },
      orderBy: { createdAt: 'asc' },
      select: CONNECTION_PUBLIC_SELECT,
    })
    const byProvider = new Map<Provider, SerializedConnection[]>()
    for (const row of rows) {
      if (!isProvider(row.provider)) continue
      const connections = byProvider.get(row.provider) ?? []
      connections.push(serializeConnection(row))
      byProvider.set(row.provider, connections)
    }

    // --- Return response ---
    const integrations: IntegrationCard[] = PROVIDERS.map((provider) => {
      const connections = byProvider.get(provider) ?? []
      return {
        provider,
        providerLabel: providerLabel(provider),
        providerShortName: providerShortName(provider),
        requiredPermissions: REQUIRED_SCOPES[provider].map((scope) => scope.label),
        connection: connections[0] ?? null,
        connections,
      }
    })

    res.json({ integrations })
  }),
)

// ============================================================
// GET /api/integrations/orgs/:orgId/health — the broken-connection signal
// ============================================================
// What the app-wide badge (IH-26) counts and the hub cards deep-link from. It returns
// ONLY connections stamped `error`, deliberately never the merely-`limited` ones: a
// `limited` connection usually reflects a scope the rep withheld ON PURPOSE, and a
// permanent alarm the rep cannot silence for their own choice teaches them to ignore
// the badge — and then it stops warning about the `error` that actually needs them.
// The slim shape (id, provider, label, address, errorCode, detail) is enough to count
// and to deep-link to the fix, and nothing more. An empty list is `{ broken: [] }`, a
// healthy answer — never a 404. All of that lives in listBrokenConnections; this route
// only proves ownership and hands the result back.
router.get(
  '/health',
  wrapRoute('GET /api/integrations/orgs/:orgId/health', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute query & return response ---
    const broken = await listBrokenConnections(orgId, userId)
    res.json({ broken })
  }),
)

// ============================================================
// POST /api/integrations/orgs/:orgId/:connectionId/test — the Test button
// ============================================================
// Runs the per-capability probes (int-health, IH-18) against a live mailbox and
// returns a verdict PER capability, never a single boolean — the rep learns WHICH
// permission is broken. It is a REPAIR of the record, not just a read: whatever the
// probes find is written back to the row (status, errorCode, statusDetail), and
// `lastValidatedAt` is stamped ONLY on a clean pass, so a failed Test never makes the
// broken connection look like the freshest one.
//
// A broken integration is an EXPECTED state, so it is 200 with `ok: false`, never a
// 500 — testConnection catches every probe failure into a CapabilityResult and never
// throws for a provider problem.

/** The overall verdict written back to the row, derived from the per-capability results. */
interface AggregateVerdict {
  ok: boolean
  status: 'connected' | 'limited' | 'error'
  errorCode: IntegrationErrorCode | null
  statusDetail: string
}

/**
 * Fold the per-capability results into the connection's written-back status.
 *
 * All green → `connected`. Otherwise the connection is unhealthy: if the ONLY thing
 * wrong is a withheld scope it is `limited` / `partial_access` (amber, a deliberate
 * choice the rep can repair), but a capability that failed for any harder reason —
 * a revoked token, an unreachable provider — makes it `error` with that code, because
 * that is a break the rep did not choose. `statusDetail` joins the failing reasons so
 * the card names every broken thing, not just the first.
 */
function aggregateVerdict(capabilities: CapabilityResult[]): AggregateVerdict {
  const failing = capabilities.filter((c) => !c.ok)
  if (failing.length === 0) {
    return { ok: true, status: 'connected', errorCode: null, statusDetail: '' }
  }

  const statusDetail = failing.map((c) => c.reason).join(' ')
  // A harder failure than a merely-withheld scope makes the whole connection `error`.
  const hard = failing.find((c) => c.errorCode !== null && c.errorCode !== 'partial_access')
  if (hard) {
    return { ok: false, status: 'error', errorCode: hard.errorCode, statusDetail }
  }
  return { ok: false, status: 'limited', errorCode: 'partial_access', statusDetail }
}

router.post(
  '/:connectionId/test',
  wrapRoute('POST /api/integrations/orgs/:orgId/:connectionId/test', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const connectionId = String(req.params.connectionId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Verify the connection is this rep's, in this org ---
    // Scoped to (id, orgId, userId): a mailbox belongs to a rep, so another rep's
    // connection — in this org or any other — is simply not found, and the answer is
    // 404, never a 403 that would confirm the id names a real row.
    const connection = await prisma.oAuthConnection.findFirst({
      where: { id: connectionId, orgId, userId },
      select: { id: true, scopes: true },
    })
    if (!connection) {
      return void res.status(404).json({ error: 'Connection not found' })
    }

    // The sendable mailbox for this grant. saveConnection always upserts one, so this
    // is present for any connection a consent completed; a missing one is treated the
    // same as a missing connection.
    const mailbox = await prisma.mailAccount.findFirst({
      where: { connectionId, orgId },
      select: { id: true },
    })
    if (!mailbox) {
      return void res.status(404).json({ error: 'Connection not found' })
    }

    // --- Probe every capability, then write the verdict back ---
    const provider = await getMailProvider(mailbox.id, orgId)
    const capabilities = await testConnection(provider, connection.scopes)
    const verdict = aggregateVerdict(capabilities)

    // The verdict is written BACK to the row, scoped to (id, orgId, userId). A
    // successful Test refreshes `lastValidatedAt`; a failed one leaves it untouched
    // (undefined = no change), so the freshest "Verified" stamp is never the broken one.
    await prisma.oAuthConnection.updateMany({
      where: { id: connectionId, orgId, userId },
      data: {
        status: verdict.status,
        errorCode: verdict.errorCode,
        statusDetail: verdict.statusDetail,
        lastValidatedAt: verdict.ok ? new Date() : undefined,
      },
    })

    // --- Return response ---
    // The token-free connection is re-read so the card shows the just-written status.
    const updated = await getConnection(connectionId, orgId)
    res.json({
      result: {
        ok: verdict.ok,
        detail: verdict.statusDetail,
        errorCode: verdict.errorCode,
        capabilities,
        connection: updated,
      },
    })
  }),
)

// ============================================================
// POST /api/integrations/orgs/:orgId/:connectionId/refresh — the Refresh button
// ============================================================
// Forces a token refresh with NO consent screen, re-reads the scopes the provider
// still grants, and re-evaluates the amber state — so a scope an admin granted after
// the last consent moves the connection from `limited` back to `connected`. The whole
// re-read/re-evaluate/write-back is refreshConnection (oauthConnections.ts), the sole
// decryptor; this route only proves ownership and reports the new status.
router.post(
  '/:connectionId/refresh',
  wrapRoute('POST /api/integrations/orgs/:orgId/:connectionId/refresh', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const connectionId = String(req.params.connectionId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Force the refresh and report the new status ---
    // refreshConnection scopes its lookup to (id, orgId, userId), so another rep's id
    // is not found and returns null → 404. A revoked or unreadable grant throws AFTER
    // stamping the row `error`; that is an expected state, so we report the stamped
    // connection rather than 500.
    try {
      const connection = await refreshConnection(connectionId, orgId, userId)
      if (!connection) {
        return void res.status(404).json({ error: 'Connection not found' })
      }
      res.json({ connection })
    } catch (err) {
      if (err instanceof TokenRevokedError || err instanceof TokenUnreadableError) {
        const connection = await getConnection(connectionId, orgId)
        if (!connection) {
          return void res.status(404).json({ error: 'Connection not found' })
        }
        return void res.json({ connection })
      }
      throw err
    }
  }),
)

// ============================================================
// DELETE /api/integrations/orgs/:orgId/:connectionId — the Disconnect button
// ============================================================
// Removes a rep's connection to a provider. The grant is deleted and its MailAccount
// goes with it by cascade — a mailbox with no token to send from is not a mailbox —
// and if that mailbox was the primary, the newest remaining one is promoted in the
// same transaction so the rep is never left able to receive but not send. Email rows
// that referenced the mailbox are SetNull'd by the DB, so the org's message history
// survives the disconnect rather than being destroyed with it. All of that lives in
// disconnectConnection (oauthConnections.ts); this route only proves ownership, logs,
// and answers. A body-free 204 on success; another rep's id is 404 and deletes nothing.
router.delete(
  '/:connectionId',
  wrapRoute('DELETE /api/integrations/orgs/:orgId/:connectionId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const connectionId = String(req.params.connectionId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user!.id

    // --- Execute delete ---
    // Scoped to (id, orgId, userId) inside disconnectConnection. Another rep's — or
    // another org's — id is not found and answered 404, never a 403 that would
    // confirm the id names a real row.
    const removed = await disconnectConnection(connectionId, orgId, userId)
    if (!removed) {
      return void res.status(404).json({ error: 'Connection not found' })
    }

    // No token, and no address either — just the tenant, the rep, and which provider.
    logger.info({ orgId, userId, provider: removed.provider }, 'disconnected an integration')

    // --- Return response ---
    res.status(204).send()
  }),
)

export default router

// ============================================================
// GET /api/integrations/:provider/callback — where the provider sends the rep back
// ============================================================
// This is the ONLY unauthenticated route in the module, and it is unauthenticated BY
// NECESSITY: the provider reaches it by a top-level browser navigation from
// Google/Microsoft, which carries no session cookie and no bearer token. It carries
// NO secret — the signed `state` minted at authorize time is the whole of what says
// whose consent this is, and it is verified in constant time BEFORE a single field of
// it is read (oauthState.verifyState). A `code` and a token never appear in a log, a
// response body, or the rendered page.
//
// It mounts on its own in app.ts (app.use('/api/integrations', callbackRouter)),
// separately from the authenticated router, because it is not under /orgs/:orgId — the
// provider redirects to a fixed, org-less URI (/api/integrations/:provider/callback).
export const callbackRouter = Router()

/** The message posted to the opener window and, minus the wire fields, rendered as text. */
interface CallbackOutcome {
  provider: Provider | null
  status: 'connected' | 'limited' | 'error'
  errorCode: string | null
  statusDetail: string
  emailAddress: string | null
}

// A plain-words line per error code for the popup and the stamped row. The client keys
// its recovery UI off `errorCode`; this is the human sentence beside it.
const FAILURE_DETAIL: Partial<Record<IntegrationErrorCode, string>> = {
  state_invalid: 'This connection link is no longer valid. Please start again from Settings.',
  account_mismatch: 'Sign in to the same mailbox shown on the row you are reconnecting.',
  missing_refresh_token:
    'Google did not return the lasting permission Maincar needs. Reconnect and keep “stay signed in” selected.',
  admin_approval_required:
    'Your organization’s administrator must approve Maincar before this mailbox can connect.',
  user_cancelled: 'The connection was cancelled before it finished.',
  redirect_uri_mismatch: 'Maincar is misconfigured for this provider. Please contact support.',
  client_secret_invalid: 'Maincar is misconfigured for this provider. Please contact support.',
}

function failureDetail(code: IntegrationErrorCode): string {
  return FAILURE_DETAIL[code] ?? 'Maincar could not finish connecting this mailbox. Please try again.'
}

function failureOutcome(provider: Provider | null, code: IntegrationErrorCode): CallbackOutcome {
  return { provider, status: 'error', errorCode: code, statusDetail: failureDetail(code), emailAddress: null }
}

function successOutcome(provider: Provider, connection: SerializedConnection): CallbackOutcome {
  return {
    provider,
    status: connection.status === 'limited' ? 'limited' : 'connected',
    errorCode: connection.errorCode,
    statusDetail: connection.statusDetail ?? '',
    emailAddress: connection.emailAddress,
  }
}

/** Express query values are string | string[] | ParsedQs; take the first plain string. */
function firstString(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

/** HTML-escape text placed in the visible page body. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * JSON for embedding inside a <script> block. `<` and `>` are escaped so provider
 * text (the mailbox address) carrying `</script>` cannot break out of the tag, and
 * the two Unicode line separators are escaped because they are raw newlines in a JS
 * string literal.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Render the popup-closing page. It posts the result to `window.opener` TARGETED AT
 * THE APP'S OWN ORIGIN (never `*`), then closes itself. The message is JSON-escaped so
 * it cannot break out of the script tag; the heading is HTML-escaped.
 */
function sendCallbackPage(res: import('express').Response, outcome: CallbackOutcome): void {
  const message = {
    type: 'maincar:oauth-result',
    provider: outcome.provider,
    ok: outcome.status !== 'error',
    status: outcome.status,
    errorCode: outcome.errorCode,
    statusDetail: outcome.statusDetail,
    emailAddress: outcome.emailAddress,
  }
  const heading =
    outcome.status === 'connected'
      ? 'Connected. You can close this window.'
      : outcome.status === 'limited'
        ? 'Connected with limited access. You can close this window.'
        : 'Could not finish connecting. You can close this window.'

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(APP_NAME)}</title></head>
<body>
<main><p>${escapeHtml(heading)}</p></main>
<script>
(function () {
  var result = ${jsonForScript(message)};
  try { if (window.opener) { window.opener.postMessage(result, ${JSON.stringify(WEB_ORIGIN)}); } } catch (e) {}
  window.close();
})();
</script>
</body>
</html>`
  res.status(200).type('html').send(html)
}

/**
 * On a FAILED targeted attempt, stamp the named row so it does not keep reading as
 * it did before the attempt. Adding a new account has no row to stamp, so this is a
 * no-op there.
 */
async function stampFailedConnection(payload: StatePayload, provider: Provider, code: IntegrationErrorCode): Promise<void> {
  if (!payload.connectionId) return
  await markConnectionError(
    { orgId: payload.orgId, userId: payload.userId, provider, connectionId: payload.connectionId },
    code,
    failureDetail(code),
  )
}

/** Map an error thrown by a provider client to a stable code, or rethrow the unexpected. */
function providerErrorCode(provider: Provider, err: unknown): IntegrationErrorCode {
  if (err instanceof OAuthProviderError) return mapProviderError(provider, err.code)
  throw err
}

callbackRouter.get(
  '/:provider/callback',
  wrapRoute('GET /api/integrations/:provider/callback', async (req, res) => {
    // --- Parse & validate params ---
    const pathProvider = String(req.params.provider)
    const code = firstString(req.query.code)
    const stateParam = firstString(req.query.state)
    const providerError = firstString(req.query.error)
    const providerErrorDescription = firstString(req.query.error_description)

    // --- Verify the signed state BEFORE reading a single field from it ---
    const verified = verifyState(stateParam)
    if (!verified.ok) {
      // No field of the state is trusted, so nothing is written. The path provider is
      // only a label for the page, never a tenant decision.
      return void sendCallbackPage(res, failureOutcome(isProvider(pathProvider) ? pathProvider : null, 'state_invalid'))
    }
    const { payload } = verified
    // The provider — and the org and user — come from the SIGNED state, never the path.
    if (!isProvider(payload.provider)) {
      return void sendCallbackPage(res, failureOutcome(null, 'state_invalid'))
    }
    const provider: Provider = payload.provider

    // --- The provider refused at its own consent screen ---
    if (providerError) {
      const mapped = mapProviderError(provider, providerErrorDescription || providerError)
      await stampFailedConnection(payload, provider, mapped)
      return void sendCallbackPage(res, failureOutcome(provider, mapped))
    }
    if (!code) {
      await stampFailedConnection(payload, provider, 'token_exchange_failed')
      return void sendCallbackPage(res, failureOutcome(provider, 'token_exchange_failed'))
    }

    // --- Exchange the code, then fetch identity. The code and tokens never leave here. ---
    const client = oauthClientFor(provider)
    let grant
    try {
      grant = await client.exchangeCode({ code, codeVerifier: pkceVerifierForState(stateParam) })
    } catch (err) {
      const mapped = providerErrorCode(provider, err)
      await stampFailedConnection(payload, provider, mapped)
      return void sendCallbackPage(res, failureOutcome(provider, mapped))
    }

    let identity
    try {
      identity = await client.fetchIdentity(grant.accessToken)
    } catch (err) {
      const mapped = providerErrorCode(provider, err)
      await stampFailedConnection(payload, provider, mapped)
      return void sendCallbackPage(res, failureOutcome(provider, mapped))
    }

    // --- A grant with no refresh token cannot outlive its first hour: never green ---
    if (!grant.refreshToken) {
      await stampFailedConnection(payload, provider, 'missing_refresh_token')
      return void sendCallbackPage(res, failureOutcome(provider, 'missing_refresh_token'))
    }

    // A targeted reconnect must authenticate as the SAME stable provider identity.
    // The signed state scopes the lookup to the intended org, rep, and provider; a
    // stale target or a different selected account never overwrites or creates a
    // mailbox under the wrong row.
    if (payload.connectionId) {
      const target = await prisma.oAuthConnection.findFirst({
        where: {
          id: payload.connectionId,
          orgId: payload.orgId,
          userId: payload.userId,
          provider,
        },
        select: { providerAccountId: true },
      })
      if (!target) {
        return void sendCallbackPage(res, failureOutcome(provider, 'state_invalid'))
      }
      if (target.providerAccountId !== identity.providerAccountId) {
        await stampFailedConnection(payload, provider, 'account_mismatch')
        return void sendCallbackPage(res, failureOutcome(provider, 'account_mismatch'))
      }
    }

    // --- Evaluate + store honestly. saveConnection upserts the mailbox itself, and
    // scopes every write to the org from the SIGNED state, so a state naming another
    // org can only ever write into that org. ---
    const connection = await saveConnection({
      orgId: payload.orgId,
      userId: payload.userId,
      provider,
      providerAccountId: identity.providerAccountId,
      emailAddress: identity.emailAddress,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
      grantedScopes: grant.grantedScopes,
    })

    // The consent is already durable. A queue outage must not turn a successful
    // OAuth callback into an error page; pg-boss retains the job once accepted.
    void Promise.resolve(queueMailBackfillForConnection(connection.id, payload.orgId)).catch((error) => {
      logger.error({ error, connectionId: connection.id, orgId: payload.orgId }, 'mail backfill enqueue failed')
    })

    return void sendCallbackPage(res, successOutcome(provider, connection))
  }),
)
