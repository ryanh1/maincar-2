/**
 * Email composer routes: the half-written emails in the dock
 * (docs/specs/SPEC-composer-dock.md).
 *
 * Mounted at /api/email, with the org in the path
 * (/api/email/orgs/:orgId/drafts) rather than read from the caller's
 * `currentOrgId` — that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off
 * the verified caller).
 *
 * A draft is org-scoped AND private to its author, so every read and every
 * write filters on `userId` as well as `orgId`. Another member's draft is a
 * 404, never a 403: a 403 would confirm that it exists.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { EmailDraft, Prisma } from '../generated/prisma/client.js'

const router = Router()

// 12 cards, the same number the dock lays out (SPEC-composer-dock.md → 3). The
// cap is a guardrail against a runaway client, not a security boundary: two
// simultaneous POSTs can both read 11 and both create, and the next one is
// refused. Raising it is an "ask first" in the spec, because the dock's layout
// maths is written against this number.
export const MAX_OPEN_DRAFTS = 12

// The dock reads every draft the rep has here in one request — there is no
// second page to ask for, and a rep with more than 200 unsent emails has a
// different problem. The cap keeps one runaway account from turning this into a
// full table scan on every page load.
export const DRAFT_LIST_LIMIT = 200

// --- Input ---

// Shape only, never deliverability. `.email()` here would reject "ann@" — the
// address the rep is halfway through typing — and autosave fires mid-word.
// Deliverability is checked once, at send, in composer-send.
const addressSchema = z
  .string()
  .trim()
  .min(1, 'An address cannot be blank.')
  .max(320, 'An email address can be at most 320 characters.')

const addressListSchema = z
  .array(addressSchema)
  .max(100, 'A draft can hold at most 100 addresses per field.')

/**
 * The fields a caller may set on a draft.
 *
 * Every one is optional: a card is created empty the moment it opens, so that
 * every later autosave is a PATCH against an id that already exists and no
 * keystroke can race a create.
 */
export const draftInputSchema = z.object({
  mailAccountId: z.string().trim().min(1).max(200).nullable().optional(),
  recordId: z.string().trim().min(1).max(200).nullable().optional(),
  toAddrs: addressListSchema.optional(),
  ccAddrs: addressListSchema.optional(),
  bccAddrs: addressListSchema.optional(),
  subject: z
    .string()
    .max(998, 'A subject can be at most 998 characters.')
    .nullable()
    .optional(),
  // No length rule beyond the 2 MB JSON limit app.ts already sets, and no
  // sanitising: the write path is deliberately dumb. Reformatting the body would
  // re-render the editor from the response and move the caret mid-sentence.
  // Sanitising happens in composer-body, on its own ticket.
  bodyHtml: z.string().nullable().optional(),
})

/**
 * What a PATCH may set: everything POST accepts, plus the two dock-state flags.
 *
 * They are two flags and not one because they answer different questions.
 * `isMinimized` is "this card is collapsed to a chip"; `isOpen` is "this card is
 * in the dock at all". Closing a card is a SAVE — `isOpen: false` — and the
 * draft is kept. Only DELETE throws one away.
 */
export const draftPatchSchema = draftInputSchema.extend({
  isOpen: z.boolean().optional(),
  isMinimized: z.boolean().optional(),
})

// --- Mappers: database row → API shape ---

// orgId and userId are deliberately absent: the caller is the author and named
// the org in the path, so repeating both adds nothing and puts a tenant key in
// one more place that could drift.
function mapDraftToApi(draft: EmailDraft) {
  return {
    id: draft.id,
    mailAccountId: draft.mailAccountId,
    recordId: draft.recordId,
    toAddrs: draft.toAddrs,
    ccAddrs: draft.ccAddrs,
    bccAddrs: draft.bccAddrs,
    subject: draft.subject,
    bodyHtml: draft.bodyHtml,
    isOpen: draft.isOpen,
    isMinimized: draft.isMinimized,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/email/orgs/:orgId/drafts — this rep's drafts in this org
// ============================================================
// Closed drafts are included on purpose. `isOpen: false` means the card was
// dismissed but the draft was KEPT — closing an email has never meant throwing
// it away — and the dock's "3 drafts" button is the only way back to one.
// Filtering them out here would silently discard work.
router.get(
  '/orgs/:orgId/drafts',
  wrapRoute('GET /api/email/orgs/:orgId/drafts', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // Read newest-edit-first and reverse, rather than asking for the oldest 200:
    // past the cap, "oldest first" in the query would drop the drafts the rep
    // touched most recently — the only ones they are likely to want back.
    // `id` breaks a tie so two drafts saved in the same millisecond keep a
    // stable order between requests.
    const rows = await prisma.emailDraft.findMany({
      where: { orgId, userId: authReq.user!.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: DRAFT_LIST_LIMIT,
    })

    // --- Return response ---
    // Oldest first, because the dock lays cards out left to right and the
    // newest one belongs on the right (SPEC-composer-dock.md → 3).
    const drafts = rows.reverse().map(mapDraftToApi)
    res.json({ drafts, total: drafts.length })
  }),
)

// ============================================================
// POST /api/email/orgs/:orgId/drafts — open a card
// ============================================================
// Creates the row immediately, and normally empty. A body is accepted so a
// composer opened from a record can land with its recipient already in place.
router.post(
  '/orgs/:orgId/drafts',
  wrapRoute('POST /api/email/orgs/:orgId/drafts', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    // Before the body is read: a non-member must not be able to write a row in
    // this org, and must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = draftInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Build filters ---
    // Only OPEN cards count against the cap. Closed drafts are kept forever and
    // occupy no room in the dock, so counting them would refuse a rep a new
    // composer because of an email they finished with last month.
    const openCount = await prisma.emailDraft.count({
      where: { orgId, userId, isOpen: true },
    })

    if (openCount >= MAX_OPEN_DRAFTS) {
      // The message says what to do about it, not which rule fired.
      return void res.status(409).json({
        error: `You have ${MAX_OPEN_DRAFTS} composers open. Close or discard one before starting another.`,
      })
    }

    // --- Execute query ---
    // orgId and userId come from the verified caller and the path, never from
    // the body: a caller must not be able to write a draft into another org or
    // under another rep's name.
    const draft = await prisma.emailDraft.create({
      data: {
        orgId,
        userId,
        mailAccountId: parsed.data.mailAccountId ?? null,
        recordId: parsed.data.recordId ?? null,
        toAddrs: parsed.data.toAddrs ?? [],
        ccAddrs: parsed.data.ccAddrs ?? [],
        bccAddrs: parsed.data.bccAddrs ?? [],
        subject: parsed.data.subject ?? null,
        bodyHtml: parsed.data.bodyHtml ?? null,
        // isOpen and isMinimized are left to their schema defaults: a card that
        // was just opened is open and expanded, and there is nothing else a
        // caller could sensibly ask for here.
      },
    })

    // --- Return response ---
    res.status(201).json({ draft: mapDraftToApi(draft) })
  }),
)

// ============================================================
// PATCH /api/email/orgs/:orgId/drafts/:draftId — autosave
// ============================================================
// Writes ONLY the keys the body carries. `{ isMinimized: true }` must leave
// `bodyHtml` alone: the card sends the field it changed, not a whole draft, and
// a handler that defaulted the absent keys would blank a half-written email
// every time the rep collapsed the card.
//
// The write path is deliberately dumb. It stores what it is given and returns
// the stored row, and it never rewrites, reformats, or re-indents `bodyHtml` —
// the editor re-renders from this response, and a reformatted body would move
// the caret mid-sentence.
router.patch(
  '/orgs/:orgId/drafts/:draftId',
  wrapRoute('PATCH /api/email/orgs/:orgId/drafts/:draftId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const draftId = String(req.params.draftId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = draftPatchSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Build filters ---
    // Key by key, and only the keys that are actually present. Spreading
    // `parsed.data` would be the same thing today, but one added field with a
    // default would quietly turn every autosave into a full overwrite.
    const body = parsed.data
    const data: Prisma.EmailDraftUpdateManyMutationInput = {}
    if ('mailAccountId' in body) data.mailAccountId = body.mailAccountId
    if ('recordId' in body) data.recordId = body.recordId
    if ('toAddrs' in body) data.toAddrs = body.toAddrs
    if ('ccAddrs' in body) data.ccAddrs = body.ccAddrs
    if ('bccAddrs' in body) data.bccAddrs = body.bccAddrs
    if ('subject' in body) data.subject = body.subject
    if ('bodyHtml' in body) data.bodyHtml = body.bodyHtml
    if ('isOpen' in body) data.isOpen = body.isOpen
    if ('isMinimized' in body) data.isMinimized = body.isMinimized

    // An empty patch is refused rather than run. `@updatedAt` would fire on a
    // write that changed nothing, and `updatedAt` is what orders the dock left
    // to right — a no-op save would shuffle the rep's cards.
    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Name a field to save.' })
    }

    // --- Execute query ---
    // updateMany filtered on all three keys, never `update({ where: { id } })`:
    // the where clause IS the boundary, so another org's draft and another
    // member's draft both come back as count 0 even if the gate above were
    // bypassed. Count 0 is a 404, never a 403 — a 403 would confirm the draft
    // exists and tell the caller they had guessed a real id.
    const result = await prisma.emailDraft.updateMany({
      where: { id: draftId, orgId, userId },
      data,
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Draft not found' })
    }

    // Read the row back, through the same three keys, because updateMany
    // returns a count and the client needs the stored draft.
    const draft = await prisma.emailDraft.findFirst({ where: { id: draftId, orgId, userId } })
    if (!draft) {
      return void res.status(404).json({ error: 'Draft not found' })
    }

    // --- Return response ---
    res.json({ draft: mapDraftToApi(draft) })
  }),
)

// ============================================================
// DELETE /api/email/orgs/:orgId/drafts/:draftId — discard
// ============================================================
// The only thing in the module that destroys a draft. Closing a card is a PATCH
// with `isOpen: false`; this is the trash can, behind an AlertDialog on the
// client (SPEC-composer-dock.md → API).
router.delete(
  '/orgs/:orgId/drafts/:draftId',
  wrapRoute('DELETE /api/email/orgs/:orgId/drafts/:draftId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const draftId = String(req.params.draftId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // deleteMany with both tenant keys, for the same reason PATCH uses
    // updateMany. Another member's draft deletes nothing and answers 404.
    const result = await prisma.emailDraft.deleteMany({ where: { id: draftId, orgId, userId } })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Draft not found' })
    }

    // --- Return response ---
    // The id comes back so the client can drop exactly that card, without
    // having to trust the request it just sent.
    res.json({ draft: { id: draftId } })
  }),
)

export default router
