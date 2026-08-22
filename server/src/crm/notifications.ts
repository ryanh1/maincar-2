/**
 * notifications — the single writer for durable, in-app notification events.
 *
 * An event is an actor/verb/object fact. It creates one NotificationObject and a
 * private Notification row for every active recipient in the same organization.
 * The object has a deterministic event key, and recipient rows have a database
 * uniqueness constraint, so retried work cannot duplicate either half.
 *
 * This module deliberately does not send a channel delivery. Email and push have
 * different retry and policy concerns; they can consume these durable rows later.
 */
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

/** A client able to make the event and all recipient rows atomic. */
export type NotificationWriterClient = Pick<PrismaClient, '$transaction'>

/**
 * The deliberately narrow fallback retained after a source is deleted or becomes
 * inaccessible. It is plain text only — never source HTML, rich text, or a raw
 * record payload — so the inbox has a safe unavailable-source representation.
 */
export interface NotificationSourceSnapshot {
  title: string
  preview?: string | null
}

export interface NotificationEvent {
  // Server-derived from the authenticated source object, never a recipient claim.
  orgId: string
  // Deterministic at the source, for example `call-comment:<id>:mentions:v1`.
  eventKey: string
  // The actor must be an active member of orgId. The writer never trusts a caller
  // to merely assert that relation.
  actorUserId: string
  // Validated strings rather than a database enum, so new notification kinds do
  // not require a Postgres type migration.
  verb: string
  object: {
    type: string
    id: string
    sourceSnapshot: NotificationSourceSnapshot
  }
  // Candidate IDs, commonly resolved from validated structured mention nodes.
  recipientUserIds: readonly string[]
}

export interface FanOutNotificationResult {
  notificationObjectId: string
  recipientUserIds: string[]
  // Candidate IDs that were not active members of this event's org. The actor is
  // suppressed by design and is not reported as rejected.
  rejectedRecipientUserIds: string[]
}

export class NotificationEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotificationEventError'
  }
}

const HTML_TAG = /<\/?[a-z!][^>]*>/i

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new NotificationEventError(`${field} must be a string.`)
  const normalized = value.trim()
  if (normalized.length === 0) throw new NotificationEventError(`${field} is required.`)
  if (normalized.length > maxLength) {
    throw new NotificationEventError(`${field} must be at most ${maxLength} characters.`)
  }
  return normalized
}

function snapshotText(value: unknown, field: string, maxLength: number): string {
  const normalized = requiredString(value, `source snapshot ${field}`, maxLength).replace(/\s+/g, ' ')
  if (HTML_TAG.test(normalized)) {
    throw new NotificationEventError(`source snapshot ${field} must be plain text.`)
  }
  return normalized
}

function normalizeSnapshot(snapshot: NotificationSourceSnapshot): NotificationSourceSnapshot {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new NotificationEventError('source snapshot must be an object.')
  }

  const title = snapshotText(snapshot.title, 'title', 200)
  if (snapshot.preview === undefined || snapshot.preview === null) return { title }
  return { title, preview: snapshotText(snapshot.preview, 'preview', 500) }
}

/**
 * Fan an already server-derived event out to active organization members.
 *
 * Candidate recipients from a different org (or an inactive membership) are
 * rejected rather than written. The actor is always suppressed, including when a
 * source accidentally puts the actor in its mention list. One transaction covers
 * membership validation, object creation, and all recipient rows.
 */
export async function fanOutNotification(
  client: NotificationWriterClient,
  event: NotificationEvent,
): Promise<FanOutNotificationResult> {
  const orgId = requiredString(event.orgId, 'orgId', 191)
  const eventKey = requiredString(event.eventKey, 'eventKey', 400)
  const actorUserId = requiredString(event.actorUserId, 'actorUserId', 191)
  const verb = requiredString(event.verb, 'verb', 80)
  const objectType = requiredString(event.object?.type, 'object type', 80)
  const objectId = requiredString(event.object?.id, 'object id', 191)
  const sourceSnapshot = normalizeSnapshot(event.object?.sourceSnapshot)

  if (!Array.isArray(event.recipientUserIds)) {
    throw new NotificationEventError('recipientUserIds must be an array.')
  }
  const recipientUserIds = [...new Set(event.recipientUserIds.map((id) => requiredString(id, 'recipient user id', 191)))]
  const membershipCandidates = [...new Set([actorUserId, ...recipientUserIds])]

  return client.$transaction(async (tx) => {
    // This validates BOTH sides of the authority boundary from the same org-scoped
    // source: an event cannot name a foreign actor or write a foreign recipient.
    const activeMembers = await tx.membership.findMany({
      where: { orgId, isActive: true, userId: { in: membershipCandidates } },
      select: { userId: true },
    })
    const activeUserIds = new Set(activeMembers.map((member) => member.userId))
    if (!activeUserIds.has(actorUserId)) {
      throw new NotificationEventError('actorUserId must be an active member of orgId.')
    }

    const validRecipientUserIds = recipientUserIds.filter(
      (userId) => userId !== actorUserId && activeUserIds.has(userId),
    )
    const rejectedRecipientUserIds = recipientUserIds.filter(
      (userId) => userId !== actorUserId && !activeUserIds.has(userId),
    )

    // `update: {}` is intentional. An event key names one immutable event, so a
    // retry must retain its original safe snapshot and never rewrite its identity.
    const notificationObject = await tx.notificationObject.upsert({
      where: { orgId_eventKey: { orgId, eventKey } },
      create: {
        orgId,
        eventKey,
        actorUserId,
        verb,
        objectType,
        objectId,
        sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
      },
      update: {},
      select: { id: true },
    })

    if (validRecipientUserIds.length > 0) {
      await tx.notification.createMany({
        data: validRecipientUserIds.map((recipientUserId) => ({
          orgId,
          notificationObjectId: notificationObject.id,
          recipientUserId,
          readAt: null,
          archivedAt: null,
          snoozedUntil: null,
        })),
        // The database's per-object recipient key is the race-safe idempotency
        // guard when two retries pass membership validation concurrently.
        skipDuplicates: true,
      })
    }

    return {
      notificationObjectId: notificationObject.id,
      recipientUserIds: validRecipientUserIds,
      rejectedRecipientUserIds,
    }
  })
}
