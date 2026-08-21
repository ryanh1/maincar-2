/**
 * Text-message routes — READ ONLY (MAI-138, T10; spec §6, plan T10).
 *
 * Mounted at /api/orgs/:orgId/messages. The org lives in the path, never the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route requires auth and an active membership in the org
 * named by the path, and every query carries the orgId filter.
 *
 * READ ONLY, on purpose. Sending a text, and the Twilio inbound/status webhooks
 * that will write these rows, are a LATER spec — this ticket lands the tables and
 * the way back out of them. There is deliberately no POST/PATCH/DELETE here: a
 * half-built send route that looks live is worse than no send route (CLAUDE.md →
 * Verification before finishing).
 *
 * WHAT THIS FILE MUST NEVER DO: touch the dialer. Call, PhoneNumber, and the
 * Twilio voice webhooks are owned elsewhere; `phoneNumberId` is returned as a
 * bare id and this router never joins past it.
 */
import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  SMS_CHANNELS,
  SMS_DIRECTIONS,
  SMS_STATUSES,
  mapSmsToDetailApi,
  mapSmsToListApi,
} from '../crm/smsActivity.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

export const LIST_DEFAULT_LIMIT = 25

// 100, the same ceiling the call history and the email list use: a message list
// is read a page at a time, and past a hundred rows the payload is bandwidth
// nobody scrolls through. A caller asking for more is capped rather than refused.
export const LIST_MAX_LIMIT = 100

// The columns a text list may sort on. Each token IS the Prisma field name it
// orders by, so the orderBy is built straight from the parsed value with no
// second mapping to drift — and the enum is the allowlist that stops an arbitrary
// column name reaching the query.
const SORT_FIELDS = ['sentAt', 'deliveredAt', 'createdAt'] as const

/**
 * An untouched optional query param arrives as `""`. For a search that means "no
 * filter", not a value to match, so it collapses to undefined rather than
 * filtering for bodies containing the empty string (which is all of them, but
 * says the wrong thing).
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())

// E.164 is at most 15 digits after the "+". The bound is a sanity cap on a query
// param, not a validator: the column stores whatever Twilio actually sent, and a
// filter that refused a number we had stored would be unable to find it.
const optionalE164 = z.preprocess(blankToUndefined, z.string().trim().max(20).optional())

// Query-string params, so every value coerces from a string. Bounds are clamped
// and each field defaults, so a bare `GET …/messages` is valid and returns page one.
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  sort: z
    .enum(SORT_FIELDS, { error: `Sort by one of: ${SORT_FIELDS.join(', ')}.` })
    .default('sentAt'),
  dir: z.enum(['asc', 'desc'], { error: 'Sort direction is asc or desc.' }).default('desc'),

  // Spine filters — the Person, Company, and Deal feeds.
  personId: optionalId,
  companyId: optionalId,
  dealId: optionalId,
  // Whose number it went out on, and which of our numbers it was.
  mailboxUserId: optionalId,
  phoneNumberId: optionalId,

  direction: z
    .enum(SMS_DIRECTIONS, { error: `direction is one of: ${SMS_DIRECTIONS.join(', ')}.` })
    .optional(),
  status: z
    .enum(SMS_STATUSES, { error: `status is one of: ${SMS_STATUSES.join(', ')}.` })
    .optional(),
  channel: z
    .enum(SMS_CHANNELS, { error: `channel is one of: ${SMS_CHANNELS.join(', ')}.` })
    .optional(),

  // The RAW-number filters, and they are the reason this model works at all: a
  // text from a stranger has no personId to filter on, so the only way to find
  // the conversation is by the number that sent it (spec §6, and §5.12's rule
  // applied to phone numbers). Both sides are filterable because "everything with
  // this number" is two different questions depending on who started it.
  fromE164: optionalE164,
  toE164: optionalE164,

  // Free text over the message body. A text body is small — unlike an email body,
  // which is why this searches the body directly and the email list does not.
  q: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
})

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/messages — the org's text-message list
// ============================================================
// Paginated, sortable, and filterable by person, account, deal, rep, number,
// direction, status, channel, and free text. Scoped to the org in the path and
// nothing narrower: like the call history, the message log is the org's shared
// record of what was said. The count and the page are read against the SAME where
// clause, so `total` and the rows can never describe different filters.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/messages', async (req, res) => {
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
    const {
      page,
      limit,
      sort,
      dir,
      personId,
      companyId,
      dealId,
      mailboxUserId,
      phoneNumberId,
      direction,
      status,
      channel,
      fromE164,
      toE164,
      q,
    } = parsed.data

    // --- Build filters ---
    // orgId is the tenant boundary, always, and it is the first key in every
    // composite index this table carries.
    const where: Prisma.SmsMessageWhereInput = {
      orgId,
      ...(personId ? { personId } : {}),
      ...(companyId ? { companyId } : {}),
      ...(dealId ? { dealId } : {}),
      ...(mailboxUserId ? { mailboxUserId } : {}),
      ...(phoneNumberId ? { phoneNumberId } : {}),
      ...(direction ? { direction } : {}),
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
      ...(fromE164 ? { fromE164 } : {}),
      ...(toE164 ? { toE164 } : {}),
      ...(q ? { body: { contains: q, mode: 'insensitive' as const } } : {}),
    }

    // --- Execute query ---
    // Count and page in parallel against one where clause. The sort is the
    // caller's chosen column with createdAt as a stable tie-break, so rows that
    // share a timestamp keep a deterministic order across pages rather than
    // shuffling between requests. When the sort already IS createdAt the tie-break
    // would just repeat it, so it is dropped.
    //
    // `nulls: 'last'` on the chosen column: sentAt is null on a message we have
    // logged but Twilio has not accepted yet (and deliveredAt on anything that
    // never landed), and Postgres sorts NULLs FIRST on a DESC order — which would
    // put every dateless row at the top of "newest first". They belong at the end.
    const orderBy: Prisma.SmsMessageOrderByWithRelationInput[] =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' as const }]

    const [total, messages] = await Promise.all([
      prisma.smsMessage.count({ where }),
      prisma.smsMessage.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        // The media rows themselves are NOT loaded with the page: a list row only
        // needs to know that media exist, and `numMedia` is the column Twilio
        // already gave us for exactly that. The detail route loads them.
      }),
    ])

    // --- Return response ---
    res.json({ messages: messages.map(mapSmsToListApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/messages/:id — one message, in full
// ============================================================
// The whole record: the body, the delivery failure detail, the Twilio SIDs, and
// every piece of MMS media in the order it arrived. Scoped to the org in the
// path — a message in another org, or one that does not exist, is answered 404
// the same way, so this route never confirms the existence of a row it must not
// reveal.
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/messages/:id', async (req, res) => {
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
    const message = await prisma.smsMessage.findFirst({
      where: { id, orgId },
      // sortOrder first, because an MMS with two images is two images IN AN
      // ORDER — the order Twilio numbered them on the webhook.
      include: { media: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    })
    if (!message) {
      return void res.status(404).json({ error: 'Message not found' })
    }

    // --- Return response ---
    res.json({ message: mapSmsToDetailApi(message) })
  }),
)

export default router
