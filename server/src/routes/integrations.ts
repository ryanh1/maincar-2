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

import { OAUTH_STATE_SECRET } from '../config.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import {
  CONNECTION_PUBLIC_SELECT,
  serializeConnection,
  type SerializedConnection,
} from '../lib/mail/oauthConnections.js'
import { isProvider, oauthClientFor, PROVIDERS } from '../lib/mail/oauthProviders.js'
import { requireMembership } from '../lib/membership.js'
import {
  allRequestedScopes,
  missingScopeParams,
  providerLabel,
  REQUIRED_SCOPES,
  type Provider,
} from '../lib/oauthScopes.js'
import { signState } from '../lib/oauthState.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

// mergeParams so `:orgId` from the mount path (/api/integrations/orgs/:orgId) reaches
// req.params here — without it the tenant id the whole file depends on would be
// undefined and every membership check would silently fail open.
const router = Router({ mergeParams: true })

router.use(requireAuth)

/** The card the hub renders per provider. One per PROVIDER, never per connection. */
interface IntegrationCard {
  provider: Provider
  providerLabel: string
  /** The plain-words permissions Maincar asks for, shown on the card. */
  requiredPermissions: string[]
  /** The rep's connection for this provider, token-free — or null when none exists. */
  connection: SerializedConnection | null
}

// The authorize body. `mode: 'fix'` is an incremental re-consent for a connection the
// rep already has, so it names one; `mode: 'connect'` is a first grant and names none.
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

    if (mode === 'fix') {
      if (!parsed.data.connectionId) {
        return void res.status(400).json({ error: 'A repair needs a connectionId.' })
      }
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

      const missing = missingScopeParams(provider, connection.scopes)
      if (missing.length === 0) {
        // Nothing is missing, so there is nothing to re-consent to. Building a URL
        // with an empty scope set would be rejected by the provider anyway.
        return void res.status(400).json({ error: 'This connection has every permission already.' })
      }
      scopes = missing
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
    // belongs to a rep (orgId, userId), and the model is unique on
    // (orgId, userId, provider), so there is at most one row per provider.
    const rows = await prisma.oAuthConnection.findMany({
      where: { orgId, userId },
      select: CONNECTION_PUBLIC_SELECT,
    })
    const byProvider = new Map(rows.map((row) => [row.provider, row]))

    // --- Return response ---
    const integrations: IntegrationCard[] = PROVIDERS.map((provider) => {
      const row = byProvider.get(provider)
      return {
        provider,
        providerLabel: providerLabel(provider),
        requiredPermissions: REQUIRED_SCOPES[provider].map((scope) => scope.label),
        connection: row ? serializeConnection(row) : null,
      }
    })

    res.json({ integrations })
  }),
)

export default router
