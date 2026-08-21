/**
 * activityFeed — the ONE place a feed row is written, and the ONE place a feed row
 * is built from an activity (MAI-140 T12, spec §5.11a / §6, plan T12).
 *
 * ActivityEntry is a DENORMALIZED CACHE. A Company or Deal page's "everything that
 * happened here" list is a single indexed range scan over this table instead of a
 * five-way union across Call, Email, SmsMessage, Meeting, and Note. That is the
 * whole point, and it is also the whole risk: a cache that can disagree with the
 * rows it caches is worse than no cache, because it is believed.
 *
 * Three rules keep it honest, and each one is ENFORCED rather than documented:
 *
 *   1. A FEED ROW IS ATOMIC WITH ITS ACTIVITY. `recordActivityInTx` takes only a
 *      `Prisma.TransactionClient`, never the base PrismaClient — exactly as
 *      ./fieldHistory.ts does — so writing a feed row outside the transaction that
 *      wrote the activity is a TYPE ERROR, not a review catch. Both rows commit or
 *      neither does. A rolled-back call leaves no feed row claiming it happened.
 *   2. ONE FEED ROW PER SOURCE ROW, FOREVER. The write is an upsert on
 *      `@@unique([orgId, sourceType, sourceId])`, so a retried job, a webhook
 *      delivered twice, or a re-sync REFRESHES the row rather than appending a
 *      second copy. Both key columns are NOT NULL in the schema, which is what
 *      makes that constraint actually bite: Postgres treats NULLs as distinct in a
 *      unique index, so a nullable key column silently defeats it.
 *   3. THE FEED IS NEVER THE SOURCE OF TRUTH. `sourceType` + `sourceId` point at
 *      the real row. Nothing reads this table to answer "how long was that call" or
 *      "who was cc'd" — it answers "what happened here, in order", and nothing else.
 *
 * The `activityFrom*` builders below are the other half: they turn a stored
 * Call/Email/SmsMessage/Meeting row into the feed row it deserves, so the summary
 * text a user reads is written in ONE place per activity type rather than at every
 * call site. They are pure functions, which is why they can be unit-tested without
 * a database.
 */
import type {
  Call,
  Email,
  Meeting,
  Prisma,
  SmsMessage,
} from '../generated/prisma/client.js'

/**
 * A client that can write a feed row: a transaction client, and ONLY that.
 *
 * `Prisma.TransactionClient` ALONE DOES NOT ENFORCE THIS, which is worth spelling
 * out because it looks like it does. That type is `Omit<PrismaClient,
 * ITXClientDenyList>`, and TypeScript is structural: a full PrismaClient has every
 * member the Omit leaves behind, so `recordActivityInTx(prisma, …)` type-CHECKS
 * against a bare `Prisma.TransactionClient` parameter. The rule the module header
 * claims — that writing a feed row outside the activity's transaction is a type
 * error — would be a comment, not a constraint, and the first caller in a hurry
 * would pass the singleton and split the feed from the rows it caches.
 *
 * The intersection below closes that. The deny-list this Prisma version removes is
 * `$connect | $disconnect | $on | $use | $extends` — note that `$transaction` is
 * NOT in it, so it cannot be used as the discriminator — which means a real
 * transaction client does not have these properties and satisfies `?: never`
 * trivially, while a PrismaClient carries all three as functions and is not
 * assignable to `never`. Passing the singleton is now rejected at the call site.
 */
export type ActivityFeedClient = Prisma.TransactionClient & {
  $connect?: never
  $disconnect?: never
  $extends?: never
}

// --- The string unions --------------------------------------------------------

/**
 * Which kind of activity a feed row summarizes. `ActivityEntry.sourceType`.
 *
 * The DB column is a String (house rule: no Prisma enums — this list gains values,
 * and a Postgres enum needs an ALTER TYPE dance to gain one); this union is the
 * type-safe half of that pair.
 *
 * `stage_change` is here alongside the four message kinds because moving a deal
 * from Discovery to Proposal is a thing that HAPPENED on the account, and a feed
 * that omits it tells a story with a hole in it. It has no message row behind it —
 * its `sourceId` is the Deal — which is exactly why `sourceId` is not a foreign key.
 */
export const ACTIVITY_SOURCE_TYPES = [
  'call',
  'email',
  'sms',
  'meeting',
  'note',
  'stage_change',
] as const

export type ActivitySourceType = (typeof ACTIVITY_SOURCE_TYPES)[number]

export function isActivitySourceType(value: unknown): value is ActivitySourceType {
  return typeof value === 'string' && (ACTIVITY_SOURCE_TYPES as readonly string[]).includes(value)
}

/**
 * Which way the activity went. `ActivityEntry.direction`.
 *
 * NULL — not a third token — where the idea does not apply. A note has no
 * direction and neither does a stage change; inventing "internal" for them would
 * put a value in a column that means "we did not ask".
 */
export const ACTIVITY_DIRECTIONS = ['outbound', 'inbound'] as const
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number]

export function isActivityDirection(value: unknown): value is ActivityDirection {
  return typeof value === 'string' && (ACTIVITY_DIRECTIONS as readonly string[]).includes(value)
}

// --- Text limits --------------------------------------------------------------

// A feed line is one row in a list, not a document. 200 characters is well past
// what any row renders and short enough that a page of 50 is a small payload.
export const SUMMARY_MAX_LENGTH = 200

// The snippet under the line — an email's first sentence, a text's body. Gmail's
// own `snippet` runs to about this length, so matching it means an ingested value
// usually survives untouched.
export const PREVIEW_MAX_LENGTH = 280

/**
 * Collapses whitespace and caps length, appending an ellipsis when it cuts.
 *
 * Whitespace first, deliberately: an email body arrives full of newlines and
 * non-breaking spaces, and a feed row that renders them is a feed row with a hole
 * punched through it. Returns null for anything that is empty once trimmed — a
 * cleared value is ABSENT, never `""` (spec §5.11).
 */
export function condense(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * A call's billed seconds as a person reads them — "45s", "4m 12s", "1h 2m".
 *
 * Null for a call that has not run (or whose duration Twilio has not reported yet),
 * so the summary says "Called +1…" rather than "Called +1… — 0s", which reads as a
 * call that connected and died.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const whole = Math.floor(seconds)
  if (whole === 0) return null
  if (whole < 60) return `${whole}s`
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) {
    const rest = whole % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

// --- The write ----------------------------------------------------------------

/** Thrown when a feed row would be written with a key the unique index cannot use. */
export class ActivityFeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActivityFeedError'
  }
}

/**
 * Everything one feed row holds. `orgId`, `sourceType`, `sourceId`, `summary`, and
 * `occurredAt` are required because the table cannot do its job without them; the
 * rest default to null.
 */
export interface NewActivityEntry {
  orgId: string
  sourceType: ActivitySourceType
  // The id of the real Call / Email / SmsMessage / Meeting / Note row.
  sourceId: string
  // The short cached line the feed renders — "Called +12025550123 — 4m 12s".
  summary: string
  // The optional snippet under it.
  preview?: string | null
  direction?: ActivityDirection | null
  occurredAt: Date
  // The "just my activity" filter's column. Null where no internal user acted.
  createdByUserId?: string | null
  companyId?: string | null
  personId?: string | null
  dealId?: string | null
}

/**
 * Writes the ONE feed row for an activity, inside the caller's transaction.
 *
 * Upsert, not create, on `(orgId, sourceType, sourceId)`: saving the same call
 * twice — a retried job, a webhook delivered again, a re-sync — refreshes the
 * summary rather than appending a second row to the feed. The org id is part of the
 * key on both halves, so a source id colliding across tenants can never make one
 * org's write land on another org's row.
 *
 * Returns the row, so a caller can assert that the activity and its feed line
 * landed together.
 */
export async function recordActivityInTx(
  tx: ActivityFeedClient,
  entry: NewActivityEntry,
): Promise<{ id: string }> {
  const orgId = entry.orgId?.trim()
  const sourceId = entry.sourceId?.trim()
  const summary = condense(entry.summary, SUMMARY_MAX_LENGTH)

  // The unique key is (orgId, sourceType, sourceId) and all three columns are NOT
  // NULL. Checking them here as well is not belt-and-braces: an empty string IS a
  // legal non-null value, and `('org', 'call', '')` would be a single row every
  // unkeyed write collided on. Fail loudly instead, inside the transaction, so the
  // activity rolls back with it.
  if (!orgId) throw new ActivityFeedError('A feed row needs the org it belongs to.')
  if (!isActivitySourceType(entry.sourceType)) {
    throw new ActivityFeedError(
      `sourceType must be one of: ${ACTIVITY_SOURCE_TYPES.join(', ')}.`,
    )
  }
  if (!sourceId) {
    throw new ActivityFeedError('A feed row needs the id of the activity it summarizes.')
  }
  if (!summary) throw new ActivityFeedError('A feed row needs a summary line to render.')
  if (entry.direction !== null && entry.direction !== undefined) {
    if (!isActivityDirection(entry.direction)) {
      throw new ActivityFeedError(
        `direction must be one of: ${ACTIVITY_DIRECTIONS.join(', ')}, or null.`,
      )
    }
  }

  // The fields a re-save is allowed to refresh. `orgId`/`sourceType`/`sourceId` are
  // the identity of the row and are deliberately absent: an update must never move
  // a feed row onto a different activity.
  const mutable = {
    summary,
    preview: condense(entry.preview, PREVIEW_MAX_LENGTH),
    direction: entry.direction ?? null,
    occurredAt: entry.occurredAt,
    createdByUserId: entry.createdByUserId ?? null,
    companyId: entry.companyId ?? null,
    personId: entry.personId ?? null,
    dealId: entry.dealId ?? null,
  }

  const row = await tx.activityEntry.upsert({
    where: {
      orgId_sourceType_sourceId: { orgId, sourceType: entry.sourceType, sourceId },
    },
    create: { orgId, sourceType: entry.sourceType, sourceId, ...mutable },
    update: mutable,
    select: { id: true },
  })
  return row
}

// --- Builders: an activity row → the feed row it deserves ---------------------

/**
 * The feed row for a call.
 *
 * The summary names the OTHER end of the call — the number dialed on an outbound,
 * the number that rang in on an inbound — because "who was this with" is the
 * question a feed row answers. The duration is appended only once it is known, so a
 * just-queued call reads "Called +12025550123" and gains "— 4m 12s" when the status
 * webhook settles the row and the writer re-saves.
 *
 * `occurredAt` prefers `startedAt`: a call placed at 4:59 and answered at 5:01
 * belongs at 5:01 in the feed only if it ever connected, and `createdAt` is the
 * honest fallback when it did not.
 */
export function activityFromCall(call: Call): NewActivityEntry {
  const inbound = call.direction === 'inbound'
  const counterparty = inbound ? call.fromE164 : call.toE164
  const duration = formatDuration(call.durationS)
  const lead = inbound ? `Call from ${counterparty}` : `Called ${counterparty}`

  return {
    orgId: call.orgId,
    sourceType: 'call',
    sourceId: call.id,
    summary: duration ? `${lead} — ${duration}` : lead,
    // The call's own lifecycle state, so a feed row can say "no answer" without a
    // join back to the Call row.
    preview: call.status,
    direction: isActivityDirection(call.direction) ? call.direction : null,
    occurredAt: call.startedAt ?? call.createdAt,
    // The member who placed or received it — this is what "just my activity" means
    // for a call.
    createdByUserId: call.userId,
    companyId: call.companyId,
    personId: call.personId,
    dealId: call.dealId,
  }
}

/**
 * The feed row for an email.
 *
 * No `personId`: an Email has MANY participants (spec §5.12) and no single person
 * link, so the caller passes one in when it knows which person's page this belongs
 * on. Same for the actor — an Email row points at a MailAccount, not at a user, and
 * resolving that is a read the caller has already done.
 *
 * A subject-less email is real (Gmail sends them, and so do bots), so the summary
 * falls back to "(no subject)" rather than to an empty line.
 */
export function activityFromEmail(
  email: Email,
  links: { createdByUserId?: string | null; personId?: string | null } = {},
): NewActivityEntry {
  const subject = condense(email.subject, SUMMARY_MAX_LENGTH) ?? '(no subject)'
  const inbound = email.direction === 'inbound'

  return {
    orgId: email.orgId,
    sourceType: 'email',
    sourceId: email.id,
    summary: inbound ? `Email received: ${subject}` : `Email sent: ${subject}`,
    // The provider's own snippet when there is one, the plaintext body when there
    // is not. Never the HTML: a feed row must not render markup it did not build.
    preview: condense(email.snippet ?? email.bodyText, PREVIEW_MAX_LENGTH),
    direction: isActivityDirection(email.direction) ? email.direction : null,
    occurredAt: email.sentAt ?? email.receivedAt ?? email.createdAt,
    createdByUserId: links.createdByUserId ?? null,
    companyId: email.companyId,
    personId: links.personId ?? null,
    dealId: email.dealId,
  }
}

/**
 * The feed row for a text.
 *
 * The body IS the message, so it rides in `preview` in full (up to the cap) rather
 * than being summarized away. The summary line stays the who/which-way pair, so a
 * feed scans consistently whatever the activity type.
 */
export function activityFromSms(message: SmsMessage): NewActivityEntry {
  const inbound = message.direction === 'inbound'
  const counterparty = inbound ? message.fromE164 : message.toE164
  const lead = inbound ? `Text from ${counterparty}` : `Texted ${counterparty}`
  // An MMS with no body is a picture, and "Texted +1… — 2 images" says more than a
  // blank line does.
  const mediaNote = message.numMedia > 0 ? `${message.numMedia} attached` : null

  return {
    orgId: message.orgId,
    sourceType: 'sms',
    sourceId: message.id,
    summary: mediaNote ? `${lead} — ${mediaNote}` : lead,
    preview: condense(message.body, PREVIEW_MAX_LENGTH),
    direction: isActivityDirection(message.direction) ? message.direction : null,
    occurredAt: message.sentAt ?? message.createdAt,
    // The rep whose number carried it. Null on a shared or unassigned number, which
    // is why "just my activity" is a filter and not the default view.
    createdByUserId: message.mailboxUserId,
    companyId: message.companyId,
    personId: message.personId,
    dealId: message.dealId,
  }
}

/**
 * The feed row for a meeting.
 *
 * `direction` is null: a meeting is not sent or received, and forcing it into one
 * of those would make "outbound" mean two different things in one column.
 *
 * `occurredAt` is `startsAt`, always — a meeting synced today that happened last
 * Tuesday belongs last Tuesday in the feed, which is the reason `occurredAt` exists
 * as a column separate from `createdAt`.
 */
export function activityFromMeeting(
  meeting: Meeting,
  links: { createdByUserId?: string | null } = {},
): NewActivityEntry {
  const title = condense(meeting.title, SUMMARY_MAX_LENGTH) ?? '(no title)'
  const lead = meeting.status === 'cancelled' ? `Meeting cancelled: ${title}` : `Meeting: ${title}`

  return {
    orgId: meeting.orgId,
    sourceType: 'meeting',
    sourceId: meeting.id,
    summary: lead,
    // Where it was — the room OR the video product, never the raw joinUrl, which is
    // a link a feed row has no business rendering as text.
    preview: condense(meeting.location ?? meeting.conferenceProvider, PREVIEW_MAX_LENGTH),
    direction: null,
    occurredAt: meeting.startsAt,
    createdByUserId: links.createdByUserId ?? null,
    companyId: meeting.companyId,
    // The organizer is the one person link a Meeting carries; every other attendee
    // is a MeetingAttendee row.
    personId: meeting.organizerPersonId,
    dealId: meeting.dealId,
  }
}

// --- Mapper: database row → API shape -----------------------------------------

/**
 * One feed row, as a client sees it.
 *
 * `orgId` never leaves the server — it is the tenant boundary, and the caller
 * already knows it, because it is in the path they asked on. Everything else is
 * here on purpose: the whole value of this table is that a row paints itself with
 * no follow-up fetch, so trimming fields out of the response would hand the N+1
 * straight back.
 */
export function mapActivityToApi(entry: {
  id: string
  sourceType: string
  sourceId: string
  summary: string
  preview: string | null
  direction: string | null
  occurredAt: Date
  createdByUserId: string | null
  companyId: string | null
  personId: string | null
  dealId: string | null
  createdAt: Date
}) {
  return {
    id: entry.id,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    summary: entry.summary,
    preview: entry.preview,
    direction: entry.direction,
    occurredAt: entry.occurredAt.toISOString(),
    createdByUserId: entry.createdByUserId,
    companyId: entry.companyId,
    personId: entry.personId,
    dealId: entry.dealId,
    createdAt: entry.createdAt.toISOString(),
  }
}
