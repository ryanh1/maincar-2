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
 *
 * A TEMPLATE is org-scoped, but its visibility is the data boundary: private
 * templates belong to their creator and organization templates can be used by
 * every member. `createdById` is the private owner and the attribution for a
 * shared template; a null author is valid only for an organization template
 * that outlived the rep who wrote it.
 *
 * The 404-never-403 rule is the same for both, and comes from the same
 * `requireMembership` gate: a caller outside the org is told the org does not
 * exist.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { hasAdminAuthority } from '../lib/roles.js'
import { sanitizeOptionalRichTextHtml, sanitizeRichTextHtml } from '../lib/sanitizeHtml.js'
import { MailApiError, MailAuthError, MailboxNotFoundError, RateLimitedError } from '../lib/mail/mailErrors.js'
import { BadRecipientError, NoMailboxError, sendDraftEmail } from '../lib/mail/sendEmail.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { EmailDraft, EmailSignature, EmailTemplate, Prisma } from '../generated/prisma/client.js'

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

// The three typed CRM tables a draft's record can point to (MAI-188). A custom
// object row (the generic `Record` table) is deliberately not one of them —
// nothing today opens the composer from a custom-object page.
export const RECORD_OBJECTS = ['person', 'company', 'deal'] as const
export type RecordObject = (typeof RECORD_OBJECTS)[number]

/**
 * recordId has no real foreign key (see schema.prisma → EmailDraft): a single
 * column cannot reference three separate typed tables. recordObject names
 * which one, so both fields must move together — set together, or cleared
 * together. A body that names one without the other, or disagrees on
 * null-ness, is rejected here rather than left to write a dangling pointer.
 */
function checkRecordPairing(
  data: { recordId?: string | null; recordObject?: RecordObject | null },
  ctx: z.RefinementCtx,
) {
  const hasId = 'recordId' in data && data.recordId !== undefined
  const hasObject = 'recordObject' in data && data.recordObject !== undefined
  if (!hasId && !hasObject) return
  if (hasId !== hasObject) {
    ctx.addIssue({ code: 'custom', message: 'recordId and recordObject must be set together.' })
    return
  }
  if ((data.recordId === null) !== (data.recordObject === null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'recordId and recordObject must both be null or both be set.',
    })
  }
}

/**
 * The fields a caller may set on a draft.
 *
 * Every one is optional: a card is created empty the moment it opens, so that
 * every later autosave is a PATCH against an id that already exists and no
 * keystroke can race a create.
 */
const draftFieldsSchema = z.object({
  mailAccountId: z.string().trim().min(1).max(200).nullable().optional(),
  recordObject: z.enum(RECORD_OBJECTS).nullable().optional(),
  recordId: z.string().trim().min(1).max(200).nullable().optional(),
  toAddrs: addressListSchema.optional(),
  ccAddrs: addressListSchema.optional(),
  bccAddrs: addressListSchema.optional(),
  subject: z.string().max(998, 'A subject can be at most 998 characters.').nullable().optional(),
  // No length rule beyond the 2 MB JSON limit app.ts already sets. Shape is all
  // zod checks here — the SAFETY of the markup is not a validation question,
  // because rejecting a draft that contains a `<script>` would refuse to save a
  // rep's email rather than store it harmlessly. It is stripped instead, by
  // `sanitizeOptionalRichTextHtml` on the way into the database (MAI-78).
  bodyHtml: z.string().nullable().optional(),
})

export const draftInputSchema = draftFieldsSchema.superRefine(checkRecordPairing)

/**
 * What a PATCH may set: everything POST accepts, plus the saved-state flag.
 */
export const draftPatchSchema = draftFieldsSchema
  .extend({
    isOpen: z.boolean().optional(),
  })
  .superRefine(checkRecordPairing)

// recordId has no database foreign key (schema.prisma → EmailDraft): it cannot,
// because recordObject picks one of three separate typed tables. This is the
// referential-integrity check that would otherwise be a FK constraint — run at
// write time instead, scoped to the caller's org like every other lookup here.
async function recordExists(orgId: string, recordObject: RecordObject, recordId: string) {
  switch (recordObject) {
    case 'person':
      return (await prisma.person.count({ where: { id: recordId, orgId } })) > 0
    case 'company':
      return (await prisma.company.count({ where: { id: recordId, orgId } })) > 0
    case 'deal':
      return (await prisma.deal.count({ where: { id: recordId, orgId } })) > 0
  }
}

// --- Mappers: database row → API shape ---

// orgId and userId are deliberately absent: the caller is the author and named
// the org in the path, so repeating both adds nothing and puts a tenant key in
// one more place that could drift.
function mapDraftToApi(draft: EmailDraft) {
  return {
    id: draft.id,
    mailAccountId: draft.mailAccountId,
    recordObject: draft.recordObject,
    recordId: draft.recordId,
    toAddrs: draft.toAddrs,
    ccAddrs: draft.ccAddrs,
    bccAddrs: draft.bccAddrs,
    subject: draft.subject,
    bodyHtml: draft.bodyHtml,
    isOpen: draft.isOpen,
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

    // The pairing is already enforced by the schema; this confirms the target
    // itself is real and in this org, since recordId carries no database FK.
    if (parsed.data.recordObject && parsed.data.recordId) {
      const exists = await recordExists(orgId, parsed.data.recordObject, parsed.data.recordId)
      if (!exists) {
        return void res.status(400).json({ error: 'That record could not be found.' })
      }
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
        recordObject: parsed.data.recordObject ?? null,
        recordId: parsed.data.recordId ?? null,
        toAddrs: parsed.data.toAddrs ?? [],
        ccAddrs: parsed.data.ccAddrs ?? [],
        bccAddrs: parsed.data.bccAddrs ?? [],
        subject: parsed.data.subject ?? null,
        // Through the allow-list before it is stored, for the same reason PATCH
        // does it: a composer opened from a record can land with a body, and
        // every write path that accepts HTML shares one sanitiser.
        bodyHtml: sanitizeOptionalRichTextHtml(parsed.data.bodyHtml),
        // `isOpen` is left to its schema default: a new composer is visible.
      },
    })

    // --- Return response ---
    res.status(201).json({ draft: mapDraftToApi(draft) })
  }),
)

// ============================================================
// PATCH /api/email/orgs/:orgId/drafts/:draftId — autosave
// ============================================================
// Writes ONLY the keys the body carries. `{ isOpen: false }` must leave
// `bodyHtml` alone: the card sends the field it changed, not a whole draft, and
// a handler that defaulted the absent keys would blank a half-written email
// every time the rep puts it away.
//
// The write path stores what it is given and returns the stored row. The ONE
// thing it rewrites is `bodyHtml`, which goes through the allow-list in
// `lib/sanitizeHtml.ts` before it is stored — a draft body is rendered again
// later, in the composer and in the sent email, so unsanitised HTML in this
// column is stored XSS. The client sanitises too; that is a convenience, and it
// is not what makes this safe.
//
// It never reformats or re-indents beyond that, and the sanitiser is idempotent,
// so a body that is already clean comes back byte for byte. The card owns its
// own text while it is open and does not re-read this response
// (vite/src/hooks/email/useUpdateEmailDraft.ts), so a sanitised body cannot jump
// the rep's caret — but it does mean a rep who pasted something disallowed sees
// their own version until they reload. Losing the paste silently would be worse
// than losing it visibly, and EC-15 wires the editor that stops the mismatch
// arising in the first place.
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
    // The "Unchecked" variant, not the plain one: mailAccountId is now a real
    // relation (MAI-188), and updateMany writes the FK scalar directly rather
    // than a nested relation connect.
    const data: Prisma.EmailDraftUncheckedUpdateManyInput = {}
    if ('mailAccountId' in body) data.mailAccountId = body.mailAccountId
    if ('recordObject' in body) data.recordObject = body.recordObject
    if ('recordId' in body) data.recordId = body.recordId
    if ('toAddrs' in body) data.toAddrs = body.toAddrs
    if ('ccAddrs' in body) data.ccAddrs = body.ccAddrs
    if ('bccAddrs' in body) data.bccAddrs = body.bccAddrs
    if ('subject' in body) data.subject = body.subject
    // The only key that is not stored verbatim. `sanitizeOptionalRichTextHtml`
    // keeps null as null, so "clear the body" still clears it.
    if ('bodyHtml' in body) data.bodyHtml = sanitizeOptionalRichTextHtml(body.bodyHtml)
    if ('isOpen' in body) data.isOpen = body.isOpen

    // An empty patch is refused rather than run. `@updatedAt` would fire on a
    // write that changed nothing, and `updatedAt` is what orders the dock left
    // to right — a no-op save would shuffle the rep's cards.
    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Name a field to save.' })
    }

    // Same check as POST: confirm the target is real before writing a pointer
    // to it, since recordId carries no database FK to enforce this.
    if (body.recordObject && body.recordId) {
      const exists = await recordExists(orgId, body.recordObject, body.recordId)
      if (!exists) {
        return void res.status(400).json({ error: 'That record could not be found.' })
      }
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
// POST /api/email/orgs/:orgId/drafts/:draftId/send — send it
// ============================================================
// Takes the draft id only, never a payload (docs/specs/SPEC-composer-send.md →
// API): the server sends exactly what was autosaved, so there is no second
// copy of the truth and no window where the body in flight differs from the
// body on screen.
//
// Every failure below leaves the draft row untouched — `sendDraftEmail` does
// not delete it until the provider has confirmed the send. Deleting the draft
// is the LAST step of a successful send, never the first step of an attempt.
router.post(
  '/orgs/:orgId/drafts/:draftId/send',
  wrapRoute('POST /api/email/orgs/:orgId/drafts/:draftId/send', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const draftId = String(req.params.draftId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const draft = await prisma.emailDraft.findFirst({ where: { id: draftId, orgId, userId } })
    if (!draft) {
      return void res.status(404).json({ error: 'Draft not found' })
    }

    try {
      const sent = await sendDraftEmail(orgId, userId, draft)

      // --- Return response ---
      if ('accepted' in sent) {
        return void res.json({ message: null, accepted: true })
      }
      res.json({
        message: {
          id: sent.id,
          providerMsgId: sent.providerMsgId,
          threadId: sent.threadId,
          sentAt: sent.sentAt.toISOString(),
        },
        accepted: true,
      })
    } catch (err) {
      if (err instanceof NoMailboxError || err instanceof MailboxNotFoundError) {
        return void res.status(409).json({ error: err.message, code: 'no_mailbox' })
      }
      if (err instanceof BadRecipientError) {
        return void res.status(400).json({ error: err.message, code: 'bad_recipient' })
      }
      if (err instanceof MailApiError || err instanceof MailAuthError || err instanceof RateLimitedError) {
        return void res.status(502).json({
          error: 'Your mail provider would not accept the message. Nothing was sent.',
          code: 'provider_error',
        })
      }
      throw err
    }
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

// ============================================================
// Templates (SPEC-composer-templates.md)
// ============================================================
export const TEMPLATE_DEFAULT_PAGE_SIZE = 25
export const TEMPLATE_MAX_PAGE_SIZE = 100

// Long enough for "Follow-up after a discovery call — enterprise", short enough
// that the list stays readable.
export const TEMPLATE_NAME_MAX = 200

// The same 998 the draft subject uses, which is RFC 5322's line limit.
export const TEMPLATE_SUBJECT_MAX = 998

// A body cap the draft body does not have. A draft is one rep's unsent email; a
// template is loaded by every member on every composer open, so an unbounded
// one is everyone's problem. 100 KB is far past any email a person writes.
export const TEMPLATE_BODY_MAX = 100_000

// --- Input ---

// `name` is the one field a template cannot do without: it is what the dropdown
// shows, and an unnamed template is unpickable. Subject and body may be blank —
// a rep saving a shell to fill in later is not an error — but they are never
// null, because the columns are not nullable.
//
// The `error` on the string itself answers a MISSING name, not just a blank
// one: zod's default there is "expected string, received undefined", which
// tells a rep nothing.
const templateNameSchema = z
  .string({ error: 'A template needs a name.' })
  .trim()
  .min(1, 'A template needs a name.')
  .max(TEMPLATE_NAME_MAX, `A template name can be at most ${TEMPLATE_NAME_MAX} characters.`)

const templateSubjectSchema = z
  .string()
  .max(TEMPLATE_SUBJECT_MAX, `A subject can be at most ${TEMPLATE_SUBJECT_MAX} characters.`)

// Shape and size only. As with a draft body, markup SAFETY is not a validation
// question — a body containing a `<script>` is stripped by the allow-list on the
// way in, never refused, because refusing would throw away the rep's writing.
const templateBodySchema = z
  .string()
  .max(TEMPLATE_BODY_MAX, `A template body can be at most ${TEMPLATE_BODY_MAX} characters.`)

/**
 * What POST accepts.
 *
 * `fieldsJson` is deliberately absent, here and on the patch schema. It is
 * DERIVED — recomputed server-side from the stored text on every write once
 * merge fields land — so a client-supplied value must not reach the column.
 * zod strips unknown keys, which is what makes "ignored" true rather than
 * merely intended.
 */
export const templateInputSchema = z.object({
  name: templateNameSchema,
  subject: templateSubjectSchema.optional(),
  bodyHtml: templateBodySchema.optional(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']).optional(),
})

/** What PATCH accepts: the same fields, with the name optional but never blank. */
export const templatePatchSchema = z.object({
  name: templateNameSchema.optional(),
  subject: templateSubjectSchema.optional(),
  bodyHtml: templateBodySchema.optional(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']).optional(),
})

const templateListQuery = z.object({
  scope: z.enum(['private', 'organization', 'all']).catch('all'),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(TEMPLATE_MAX_PAGE_SIZE).catch(TEMPLATE_DEFAULT_PAGE_SIZE),
  sort: z.enum(['name', 'subject', 'author']).catch('name'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  q: z.string().trim().max(120).catch(''),
})

function templateOrderBy(
  sort: 'name' | 'subject' | 'author',
  dir: 'asc' | 'desc',
): Prisma.EmailTemplateOrderByWithRelationInput[] {
  switch (sort) {
    case 'subject':
      return [{ subject: dir }, { id: 'asc' }]
    case 'author':
      return [
        { createdBy: { firstName: { sort: dir, nulls: 'last' } } },
        { createdBy: { lastName: { sort: dir, nulls: 'last' } } },
        { createdBy: { email: dir } },
        { id: 'asc' },
      ]
    case 'name':
      return [{ name: dir }, { id: 'asc' }]
  }
}

function templateListWhere(
  orgId: string,
  userId: string,
  scope: 'private' | 'organization' | 'all',
  q: string,
): Prisma.EmailTemplateWhereInput {
  const visibilityWhere: Prisma.EmailTemplateWhereInput =
    scope === 'private'
      ? { visibility: 'PRIVATE', createdById: userId }
      : scope === 'organization'
        ? { visibility: 'ORGANIZATION' }
        : {
            OR: [
              { visibility: 'PRIVATE', createdById: userId },
              { visibility: 'ORGANIZATION' },
            ],
          }

  const searchWhere: Prisma.EmailTemplateWhereInput | null = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
          { createdBy: { firstName: { contains: q, mode: 'insensitive' } } },
          { createdBy: { lastName: { contains: q, mode: 'insensitive' } } },
          { createdBy: { email: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : null

  if (!searchWhere) return { orgId, ...visibilityWhere }
  return { orgId, AND: [visibilityWhere, searchWhere] }
}

type TemplateManagement =
  | { outcome: 'not-found' }
  | { outcome: 'forbidden' }
  | { outcome: 'allowed'; where: Prisma.EmailTemplateWhereInput }

function templateManagement(
  template: EmailTemplate,
  orgId: string,
  userId: string,
  membershipRoles: readonly string[],
): TemplateManagement {
  if (template.visibility === 'PRIVATE') {
    if (template.createdById !== userId) return { outcome: 'not-found' }
    return {
      outcome: 'allowed',
      where: { id: template.id, orgId, visibility: 'PRIVATE', createdById: userId },
    }
  }

  if (template.createdById === userId) {
    return {
      outcome: 'allowed',
      where: { id: template.id, orgId, visibility: 'ORGANIZATION', createdById: userId },
    }
  }

  if (!hasAdminAuthority(membershipRoles)) return { outcome: 'forbidden' }
  return { outcome: 'allowed', where: { id: template.id, orgId, visibility: 'ORGANIZATION' } }
}

// --- Mappers: database row → API shape ---

// `orgId` is absent for the same reason it is absent from a draft: the caller
// named the org in the path. `createdById` IS returned — the list can say who
// wrote one — and a null means the author has left the org. That is a fact
// about the template, not an error.
function mapTemplateToApi(template: EmailTemplate) {
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    visibility: template.visibility,
    createdById: template.createdById,
    fieldsJson: template.fieldsJson,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }
}

// ============================================================
// GET /api/email/orgs/:orgId/templates — safely scoped templates in this org
// ============================================================
router.get(
  '/orgs/:orgId/templates',
  wrapRoute('GET /api/email/orgs/:orgId/templates', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const { scope, page, limit, sort, dir, q } = templateListQuery.parse(req.query ?? {})

    // --- Build filters ---
    const where = templateListWhere(orgId, authReq.user!.id, scope, q)

    // --- Execute query ---
    const [total, rows] = await Promise.all([
      prisma.emailTemplate.count({ where }),
      prisma.emailTemplate.findMany({
        where,
        orderBy: templateOrderBy(sort, dir),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    // --- Return response ---
    const templates = rows.map(mapTemplateToApi)
    res.json({ templates, total, page, limit })
  }),
)

// ============================================================
// POST /api/email/orgs/:orgId/templates — save a new one
// ============================================================
router.post(
  '/orgs/:orgId/templates',
  wrapRoute('POST /api/email/orgs/:orgId/templates', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Before the body is read, so a non-member cannot write a row into this org
    // and cannot learn whether it exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = templateInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    // `orgId` comes from the verified path and `createdById` from the verified
    // caller, never from the body. `fieldsJson` is not written at all: the
    // column stays null until merge fields land, and the client never gets a
    // say in it.
    const template = await prisma.emailTemplate.create({
      data: {
        orgId,
        createdById: authReq.user!.id,
        name: parsed.data.name,
        subject: parsed.data.subject ?? '',
        bodyHtml: sanitizeRichTextHtml(parsed.data.bodyHtml ?? ''),
        visibility: parsed.data.visibility ?? 'PRIVATE',
      },
    })

    // --- Return response ---
    res.status(201).json({ template: mapTemplateToApi(template) })
  }),
)

// ============================================================
// PATCH /api/email/orgs/:orgId/templates/:templateId — edit one
// ============================================================
// A private template is managed only by its creator. An organization template
// is managed by its creator or an organization admin. Editing never touches a
// draft that was made from it: a template is copied into a card at pick time.
router.patch(
  '/orgs/:orgId/templates/:templateId',
  wrapRoute('PATCH /api/email/orgs/:orgId/templates/:templateId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const templateId = String(req.params.templateId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = templatePatchSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Verify ownership ---
    const existing = await prisma.emailTemplate.findFirst({ where: { id: templateId, orgId } })
    if (!existing) return void res.status(404).json({ error: 'Template not found' })

    const management = templateManagement(existing, orgId, authReq.user!.id, membership.roles)
    if (management.outcome === 'not-found') {
      return void res.status(404).json({ error: 'Template not found' })
    }
    if (management.outcome === 'forbidden') {
      return void res.status(403).json({ error: 'Only the creator or an admin can manage this template' })
    }
    if (parsed.data.visibility === 'PRIVATE' && existing.createdById === null) {
      return void res.status(409).json({ error: 'A template without a creator cannot be private' })
    }

    // --- Build filters ---
    // Key by key, only the keys that are present — the editor may save the name
    // alone, and defaulting the absent ones would blank the body.
    const body = parsed.data
    const data: Prisma.EmailTemplateUpdateManyMutationInput = {}
    if ('name' in body) data.name = body.name
    if ('subject' in body) data.subject = body.subject
    // The one key not stored verbatim, for the same reason a draft body is not:
    // a template body is rendered again in the composer and in the sent email,
    // so unsanitised HTML in this column is stored XSS.
    if ('bodyHtml' in body) data.bodyHtml = sanitizeRichTextHtml(body.bodyHtml ?? '')
    if ('visibility' in body) data.visibility = body.visibility

    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Name a field to save.' })
    }

    // --- Execute query ---
    // updateMany keeps the org and visibility/owner constraints in the write
    // itself. A concurrent visibility change cannot turn an authorized shared
    // write into an unauthorized private one.
    const result = await prisma.emailTemplate.updateMany({
      where: management.where,
      data,
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Template not found' })
    }

    // Read the row back through the same key, because updateMany returns a count.
    const template = await prisma.emailTemplate.findFirst({ where: { id: templateId, orgId } })
    if (!template) {
      return void res.status(404).json({ error: 'Template not found' })
    }

    // --- Return response ---
    res.json({ template: mapTemplateToApi(template) })
  }),
)

// ============================================================
// DELETE /api/email/orgs/:orgId/templates/:templateId — remove one
// ============================================================
// Behind an AlertDialog on the client (SPEC-composer-templates.md § 9). Drafts
// written from this template are untouched — the body was copied into the card,
// so there is no row to cascade to and nothing here to clean up.
router.delete(
  '/orgs/:orgId/templates/:templateId',
  wrapRoute('DELETE /api/email/orgs/:orgId/templates/:templateId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const templateId = String(req.params.templateId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Verify ownership ---
    const existing = await prisma.emailTemplate.findFirst({ where: { id: templateId, orgId } })
    if (!existing) return void res.status(404).json({ error: 'Template not found' })

    const management = templateManagement(existing, orgId, authReq.user!.id, membership.roles)
    if (management.outcome === 'not-found') {
      return void res.status(404).json({ error: 'Template not found' })
    }
    if (management.outcome === 'forbidden') {
      return void res.status(403).json({ error: 'Only the creator or an admin can manage this template' })
    }

    // --- Execute query ---
    // deleteMany keeps org and permission conditions in the write itself, so a
    // concurrent visibility change cannot widen the caller's authority.
    const result = await prisma.emailTemplate.deleteMany({ where: management.where })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Template not found' })
    }

    // --- Return response ---
    // The id comes back so the client can drop exactly that row.
    res.json({ template: { id: templateId } })
  }),
)

// ============================================================
// Signatures
// ============================================================
// A signature belongs to its rep, not their organization. The organization in
// the URL still verifies the active context: a caller outside it gets the same
// 404 as every other email route, but a rep's sign-off follows them between the
// organizations they belong to.

export const SIGNATURE_LIST_LIMIT = 200
export const SIGNATURE_NAME_MAX = 200
export const SIGNATURE_BODY_MAX = 100_000

const signatureNameSchema = z
  .string({ error: 'A signature needs a name.' })
  .trim()
  .min(1, 'A signature needs a name.')
  .max(SIGNATURE_NAME_MAX, `A signature name can be at most ${SIGNATURE_NAME_MAX} characters.`)

const signatureBodySchema = z
  .string()
  .max(SIGNATURE_BODY_MAX, `A signature can be at most ${SIGNATURE_BODY_MAX} characters.`)

export const signatureInputSchema = z.object({
  name: signatureNameSchema,
  bodyHtml: signatureBodySchema.optional(),
  // Kept for callers that shipped before message-context defaults existed.
  isDefault: z.boolean().optional(),
  isDefaultForNew: z.boolean().optional(),
  isDefaultForReply: z.boolean().optional(),
})

export const signaturePatchSchema = z.object({
  name: signatureNameSchema.optional(),
  bodyHtml: signatureBodySchema.optional(),
  // Kept for callers that shipped before message-context defaults existed.
  isDefault: z.boolean().optional(),
  isDefaultForNew: z.boolean().optional(),
  isDefaultForReply: z.boolean().optional(),
})

function mapSignatureToApi(signature: EmailSignature) {
  return {
    id: signature.id,
    name: signature.name,
    bodyHtml: signature.bodyHtml,
    isDefault: signature.isDefault,
    isDefaultForNew: signature.isDefaultForNew,
    isDefaultForReply: signature.isDefaultForReply,
    createdAt: signature.createdAt.toISOString(),
    updatedAt: signature.updatedAt.toISOString(),
  }
}

// ============================================================
// GET /api/email/orgs/:orgId/signatures — this rep's signatures
// ============================================================
router.get(
  '/orgs/:orgId/signatures',
  wrapRoute('GET /api/email/orgs/:orgId/signatures', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const rows = await prisma.emailSignature.findMany({
      where: { userId },
      orderBy: [{ isDefaultForNew: 'desc' }, { isDefaultForReply: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      take: SIGNATURE_LIST_LIMIT,
    })

    // --- Return response ---
    const signatures = rows.map(mapSignatureToApi)
    res.json({ signatures, total: signatures.length })
  }),
)

// ============================================================
// POST /api/email/orgs/:orgId/signatures — create one
// ============================================================
router.post(
  '/orgs/:orgId/signatures',
  wrapRoute('POST /api/email/orgs/:orgId/signatures', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = signatureInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    const data = parsed.data
    const isDefaultForNew = data.isDefaultForNew ?? data.isDefault ?? false
    const isDefaultForReply = data.isDefaultForReply ?? data.isDefault ?? false
    const signature = isDefaultForNew || isDefaultForReply
      ? await prisma.$transaction(async (tx) => {
          if (isDefaultForNew) {
            await tx.emailSignature.updateMany({
              where: { userId },
              data: { isDefault: false, defaultForUser: null, isDefaultForNew: false, defaultForNewUser: null },
            })
          }
          if (isDefaultForReply) {
            await tx.emailSignature.updateMany({
              where: { userId },
              data: { isDefaultForReply: false, defaultForReplyUser: null },
            })
          }
          return tx.emailSignature.create({
            data: {
              userId,
              name: data.name,
              bodyHtml: sanitizeRichTextHtml(data.bodyHtml ?? ''),
              isDefault: isDefaultForNew,
              defaultForUser: isDefaultForNew ? userId : null,
              isDefaultForNew,
              defaultForNewUser: isDefaultForNew ? userId : null,
              isDefaultForReply,
              defaultForReplyUser: isDefaultForReply ? userId : null,
            },
          })
        })
      : await prisma.emailSignature.create({
          data: {
            userId,
            name: data.name,
            bodyHtml: sanitizeRichTextHtml(data.bodyHtml ?? ''),
            isDefault: false,
            defaultForUser: null,
            isDefaultForNew: false,
            defaultForNewUser: null,
            isDefaultForReply: false,
            defaultForReplyUser: null,
          },
        })

    // --- Return response ---
    res.status(201).json({ signature: mapSignatureToApi(signature) })
  }),
)

// ============================================================
// PATCH /api/email/orgs/:orgId/signatures/:signatureId — edit one
// ============================================================
router.patch(
  '/orgs/:orgId/signatures/:signatureId',
  wrapRoute('PATCH /api/email/orgs/:orgId/signatures/:signatureId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const signatureId = String(req.params.signatureId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = signaturePatchSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Build filters ---
    const body = parsed.data
    const data: Prisma.EmailSignatureUncheckedUpdateManyInput = {}
    if ('name' in body) data.name = body.name
    if ('bodyHtml' in body) data.bodyHtml = sanitizeRichTextHtml(body.bodyHtml ?? '')
    const isDefaultForNew = body.isDefaultForNew ?? body.isDefault
    const isDefaultForReply = body.isDefaultForReply ?? body.isDefault
    if (isDefaultForNew !== undefined) {
      data.isDefault = isDefaultForNew
      data.defaultForUser = isDefaultForNew ? userId : null
      data.isDefaultForNew = isDefaultForNew
      data.defaultForNewUser = isDefaultForNew ? userId : null
    }
    if (isDefaultForReply !== undefined) {
      data.isDefaultForReply = isDefaultForReply
      data.defaultForReplyUser = isDefaultForReply ? userId : null
    }
    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Name a field to save.' })
    }

    // Confirm ownership before clearing another default. In particular, a
    // guessed id must never reset the caller's existing default signature.
    const existing = await prisma.emailSignature.findFirst({ where: { id: signatureId, userId } })
    if (!existing) {
      return void res.status(404).json({ error: 'Signature not found' })
    }

    // --- Execute query ---
    if (isDefaultForNew === true || isDefaultForReply === true) {
      await prisma.$transaction(async (tx) => {
        if (isDefaultForNew === true) {
          await tx.emailSignature.updateMany({
            where: { userId, id: { not: signatureId } },
            data: { isDefault: false, defaultForUser: null, isDefaultForNew: false, defaultForNewUser: null },
          })
        }
        if (isDefaultForReply === true) {
          await tx.emailSignature.updateMany({
            where: { userId, id: { not: signatureId } },
            data: { isDefaultForReply: false, defaultForReplyUser: null },
          })
        }
        await tx.emailSignature.updateMany({ where: { id: signatureId, userId }, data })
      })
    } else {
      await prisma.emailSignature.updateMany({ where: { id: signatureId, userId }, data })
    }

    const signature = await prisma.emailSignature.findFirst({ where: { id: signatureId, userId } })
    if (!signature) {
      return void res.status(404).json({ error: 'Signature not found' })
    }

    // --- Return response ---
    res.json({ signature: mapSignatureToApi(signature) })
  }),
)

// ============================================================
// DELETE /api/email/orgs/:orgId/signatures/:signatureId — remove one
// ============================================================
router.delete(
  '/orgs/:orgId/signatures/:signatureId',
  wrapRoute('DELETE /api/email/orgs/:orgId/signatures/:signatureId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const signatureId = String(req.params.signatureId)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.emailSignature.deleteMany({ where: { id: signatureId, userId } })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Signature not found' })
    }

    // --- Return response ---
    res.json({ signature: { id: signatureId } })
  }),
)

export default router
