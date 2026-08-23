/**
 * Email routes — READ ONLY (MAI-137, T9; spec §5.12, §6, plan T9).
 *
 * Mounted at /api/orgs/:orgId/emails. The org lives in the path, never the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route requires auth and an active membership in the org
 * named by the path, and every query carries the orgId filter.
 *
 * READ ONLY, on purpose. Composing, sending, and mailbox sync are a LATER spec —
 * this ticket lands the tables and the way back out of them. There is deliberately
 * no POST/PATCH/DELETE here: a half-built send route that looks live is worse than
 * no send route (CLAUDE.md → Verification before finishing).
 *
 * WHAT THIS FILE MUST NEVER DO: reach for a token. Mail credentials live on
 * OAuthConnection and the mailbox identity on MailAccount, both owned by the
 * Integration Hub. An Email row points at a mailbox with one nullable foreign key,
 * and this router never joins past it. The mailbox address a client needs comes
 * from the Integration Hub's own routes, not from here.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  EMAIL_DIRECTIONS,
  mapEmailToDetailApi,
  mapEmailToListApi,
} from '../crm/emailActivity.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25

// 100, the same ceiling the call history uses: a message list is read a page at a
// time, and past a hundred rows the payload is bandwidth nobody scrolls through.
// A caller asking for more is capped rather than refused.
export const LIST_MAX_LIMIT = 100

// The columns a message list may sort on. Each token IS the Prisma field name it
// orders by, so the orderBy is built straight from the parsed value with no second
// mapping to drift — and the enum is the allowlist that stops an arbitrary column
// name reaching the query.
const SORT_FIELDS = ['sentAt', 'receivedAt', 'createdAt', 'subject'] as const

/**
 * An untouched optional query param arrives as `""`. For a search that means "no
 * filter", not a value to match, so it collapses to undefined rather than
 * filtering for subjects containing the empty string (which is all of them, but
 * says the wrong thing).
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

// Query-string params, so every value coerces from a string. Bounds are clamped
// and each field defaults, so a bare `GET …/emails` is valid and returns page one.
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z.enum(SORT_FIELDS, { error: `Sort by one of: ${SORT_FIELDS.join(', ')}.` }).default('sentAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),

  // Roll-up filters — the Company and Deal feeds.
  companyId: optionalId,
  dealId: optionalId,
  // The mailbox the message came from. An id, never an address: the address is
  // MailAccount's to own, and matching on one here would be a second copy of it.
  mailAccountId: optionalId,
  // "Show me the rest of this thread."
  conversationId: optionalId,

  direction: z
    .enum(EMAIL_DIRECTIONS, { error: `direction is one of: ${EMAIL_DIRECTIONS.join(', ')}.` })
    .optional(),

  // Participant filters. BOTH are here and they are not redundant (§5.12): a
  // Person may hold several addresses, and an address may belong to nobody at all.
  // Filtering by personId finds the thread with someone in the CRM; filtering by
  // address finds the thread with a stranger, which is the case the whole model
  // exists to make possible.
  personId: optionalId,
  address: z.preprocess(
    blankToUndefined,
    z.string().trim().toLowerCase().max(320, 'That address is too long to be one.').optional(),
  ),

  // Free text over the subject and the preview snippet. Not the bodies: a LIKE
  // over every stored HTML body is a sequential scan of the largest columns in
  // the table, and full-text search over bodyText is its own ticket.
  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/emails — the org's message list
// ============================================================
// Paginated, sortable, and filterable by account, deal, mailbox, thread,
// direction, participant, and free text. Scoped to the org in the path and
// nothing narrower: like the call history, the message log is the org's shared
// record of what was said. The count and the page are read against the SAME where
// clause, so `total` and the rows can never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/emails', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // Before any row is read: a non-member must not see this org's messages, and
    // must not learn whether the org exists.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit, sort, dir, companyId, dealId, mailAccountId, conversationId, direction, personId, address, q } =
      parsed.data

    // --- Build filters ---
    // orgId is the tenant boundary, always, and it is repeated INSIDE the nested
    // participant filter too: a related-row condition is its own query, and a
    // `some` without orgId would reach across tenants to decide which of this
    // org's rows match.
    const participantFilters: Prisma.EmailParticipantWhereInput[] = []
    if (personId) participantFilters.push({ orgId, personId })
    if (address) participantFilters.push({ orgId, address: { equals: address, mode: 'insensitive' } })

    const where: Prisma.EmailWhereInput = {
      orgId,
      deletedAt: null,
      ...(companyId ? { companyId } : {}),
      ...(dealId ? { dealId } : {}),
      ...(mailAccountId ? { mailAccountId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(direction ? { direction } : {}),
      ...(participantFilters.length > 0
        ? { AND: participantFilters.map((some) => ({ participants: { some } })) }
        : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: 'insensitive' as const } },
              { snippet: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    // --- Execute query ---
    // Count and page in parallel against one where clause. The sort is the
    // caller's chosen column with createdAt as a stable tie-break, so rows that
    // share a timestamp keep a deterministic order across pages rather than
    // shuffling between requests. When the sort already IS createdAt the tie-break
    // would just repeat it, so it is dropped.
    //
    // `nulls: 'last'` on the chosen column: sentAt is null on a message that was
    // received but never sent by us (and receivedAt on the mirror case), and
    // Postgres sorts NULLs FIRST on a DESC order — which would put every
    // dateless row at the top of "newest first". They belong at the end.
    const orderBy: Prisma.EmailOrderByWithRelationInput[] =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' as const }]

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        // The participants come with the page because an inbox row without
        // "to whom" is not a row anyone can read, and fetching them per row
        // afterwards is the N+1 this include exists to avoid.
        include: { participants: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] } },
      }),
    ])

    // --- Return response ---
    res.json({ emails: emails.map(mapEmailToListApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/emails/:id — one message, in full
// ============================================================
// The whole record: bodies, threading headers, every participant, every
// attachment. Scoped to the org in the path — a message in another org, or one
// that does not exist, is answered 404 the same way, so this route never confirms
// the existence of a row it must not reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/emails/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // id AND orgId together, never id alone: the tenant key is half the lookup, so
    // a real id belonging to another org matches nothing and falls to the 404
    // below. Org isolation lives in the where clause, not in a check bolted on
    // after the read.
    const email = await prisma.email.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        participants: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
        attachments: { orderBy: [{ createdAt: 'asc' }] },
      },
    })
    if (!email) {
      return void res.status(404).json({ error: 'Email not found' })
    }

    // --- Return response ---
    res.json({ email: mapEmailToDetailApi(email) })
  }),
)

export default router
