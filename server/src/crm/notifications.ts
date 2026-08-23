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
 * The transaction-shaped half of the writer. Sources that already have a
 * transaction — for example a note plus its activity row — use this so their
 * source row and its inbox event cannot commit independently.
 */
export type NotificationWriterTransactionClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw' | 'membership' | 'notificationObject' | 'notification'
>

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
  // Optional server-derived grouping key for one noisy action spanning many
  // objects, such as a bulk stage change. It is never supplied by an end user.
  batchKey?: string
  // A server-derived action identity shared by a mention and assignment emitted
  // by the same source write. The assignment replaces the mention as the card's
  // representative object while both durable object ids remain in the bundle.
  dedupeKey?: string
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
const BATCH_WINDOW_MS = 5 * 60 * 1000
const BATCH_CAP_MS = 30 * 60 * 1000
const MAX_NOISY_BUNDLES_PER_RECIPIENT = 20
const IMMEDIATE_VERBS = new Set(['mention', 'mentioned', 'assignment', 'assigned'])
const NOISY_VERBS = new Set(['comment', 'commented', 'status_change', 'bulk_edit'])

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

function isAssignment(verb: string): boolean {
  return verb === 'assignment' || verb === 'assigned'
}

function isImmediate(verb: string): boolean {
  return IMMEDIATE_VERBS.has(verb)
}

function isNoisy(verb: string): boolean {
  return NOISY_VERBS.has(verb)
}

function notificationBatchKey(recipientUserId: string, verb: string, objectKey: string): string {
  return `${recipientUserId}:${verb}:${objectKey}`
}

function containsObjectId(bundle: { notificationObjectId: string; objectIds: string[] }, objectId: string): boolean {
  return bundle.notificationObjectId === objectId || bundle.objectIds.includes(objectId)
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
  return client.$transaction((tx) => fanOutNotificationInTransaction(tx, event))
}

/**
 * Fan an event out inside a source-owned transaction.
 *
 * This intentionally shares the exact validation and idempotency behaviour of
 * `fanOutNotification`; the wrapper above only supplies the transaction.
 */
export async function fanOutNotificationInTransaction(
  tx: NotificationWriterTransactionClient,
  event: NotificationEvent,
): Promise<FanOutNotificationResult> {
  const orgId = requiredString(event.orgId, 'orgId', 191)
  const eventKey = requiredString(event.eventKey, 'eventKey', 400)
  const actorUserId = requiredString(event.actorUserId, 'actorUserId', 191)
  const verb = requiredString(event.verb, 'verb', 80)
  const objectType = requiredString(event.object?.type, 'object type', 80)
  const objectId = requiredString(event.object?.id, 'object id', 191)
  const sourceSnapshot = normalizeSnapshot(event.object?.sourceSnapshot)
  const noisyObjectKey = event.batchKey === undefined
    ? undefined
    : requiredString(event.batchKey, 'batchKey', 400)
  const dedupeKey = event.dedupeKey === undefined
    ? undefined
    : requiredString(event.dedupeKey, 'dedupeKey', 400)
  if (isNoisy(verb) && noisyObjectKey === undefined) {
    throw new NotificationEventError('batchKey is required for noisy notification events.')
  }
  if ((verb === 'mention' || verb === 'assignment') && dedupeKey === undefined) {
    throw new NotificationEventError('dedupeKey is required for mention and assignment notification events.')
  }

  if (!Array.isArray(event.recipientUserIds)) {
    throw new NotificationEventError('recipientUserIds must be an array.')
  }
  const recipientUserIds = [...new Set(event.recipientUserIds.map((id) => requiredString(id, 'recipient user id', 191)))]
  const membershipCandidates = [...new Set([actorUserId, ...recipientUserIds])]

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
  // Acquire advisory locks in one stable order. Two bulk writes that share
  // recipients can then never hold each other's next lock indefinitely.
  const recipientUserIdsForWrites = [...validRecipientUserIds].sort()
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

  if (validRecipientUserIds.length === 0) {
    return {
      notificationObjectId: notificationObject.id,
      recipientUserIds: validRecipientUserIds,
      rejectedRecipientUserIds,
    }
  }

  if (isImmediate(verb) && dedupeKey === undefined) {
    await tx.notification.createMany({
      data: validRecipientUserIds.map((recipientUserId) => ({
        orgId,
        notificationObjectId: notificationObject.id,
        recipientUserId,
        batchKey: notificationBatchKey(recipientUserId, verb, `${objectType}:${objectId}`),
        objectIds: [notificationObject.id],
        deliveryMode: 'immediate',
        readAt: null,
        archivedAt: null,
        snoozedUntil: null,
      })),
      // The database's per-object recipient key is the race-safe idempotency
      // guard when two retries pass membership validation concurrently.
      skipDuplicates: true,
    })
  } else if (isImmediate(verb)) {
    for (const recipientUserId of recipientUserIdsForWrites) {
      const mentionBatchKey = notificationBatchKey(recipientUserId, 'mention', dedupeKey!)
      const assignmentBatchKey = notificationBatchKey(recipientUserId, 'assignment', dedupeKey!)
      const batchKey = isAssignment(verb) ? assignmentBatchKey : mentionBatchKey
      // Lock on the logical user action so concurrently emitted mention and
      // assignment events cannot become two cards.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notification-action:${orgId}:${recipientUserId}:${dedupeKey}`}))`
      const existing = await tx.notification.findFirst({
        where: {
          orgId,
          recipientUserId,
          batchKey: { in: [mentionBatchKey, assignmentBatchKey] },
          deliveryMode: 'immediate',
          archivedAt: null,
        },
        select: {
          id: true,
          notificationObjectId: true,
          objectIds: true,
          notificationObject: { select: { verb: true } },
        },
      })

      if (!existing) {
        await tx.notification.createMany({
          data: [{
            orgId,
            notificationObjectId: notificationObject.id,
            recipientUserId,
            batchKey,
            objectIds: [notificationObject.id],
            deliveryMode: 'immediate',
            readAt: null,
            archivedAt: null,
            snoozedUntil: null,
          }],
          skipDuplicates: true,
        })
        continue
      }

      if (containsObjectId(existing, notificationObject.id)) continue
      const assignmentWins = isAssignment(verb) && !isAssignment(existing.notificationObject.verb)
      await tx.notification.updateMany({
        where: {
          id: existing.id,
          orgId,
          recipientUserId,
          NOT: { objectIds: { has: notificationObject.id } },
        },
        data: {
          objectIds: { push: notificationObject.id },
          ...(assignmentWins
            ? { notificationObjectId: notificationObject.id, batchKey: assignmentBatchKey }
            : {}),
        },
      })
    }
  } else if (isNoisy(verb)) {
    const now = new Date()
    const slidingWindowStart = new Date(now.getTime() - BATCH_WINDOW_MS)
    const capStart = new Date(now.getTime() - BATCH_CAP_MS)

    for (const recipientUserId of recipientUserIdsForWrites) {
      const batchKey = notificationBatchKey(recipientUserId, verb, noisyObjectKey!)
      // The rate cap applies across every noisy object key, so its lock must be
      // recipient-wide. This also serializes find/update/create for each bundle.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notification-rate:${orgId}:${recipientUserId}`}))`
      const existing = await tx.notification.findFirst({
        where: {
          orgId,
          recipientUserId,
          batchKey,
          deliveryMode: { in: ['batched', 'digest'] },
          archivedAt: null,
          createdAt: { gte: capStart },
          updatedAt: { gte: slidingWindowStart },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, notificationObjectId: true, objectIds: true },
      })
      if (existing) {
        if (containsObjectId(existing, notificationObject.id)) continue
        await tx.notification.updateMany({
          where: {
            id: existing.id,
            orgId,
            recipientUserId,
            NOT: { objectIds: { has: notificationObject.id } },
          },
          data: { objectIds: { push: notificationObject.id } },
        })
        continue
      }

      const noisyBundleCount = await tx.notification.count({
        where: {
          orgId,
          recipientUserId,
          deliveryMode: { in: ['batched', 'digest'] },
          createdAt: { gte: capStart },
        },
      })
      await tx.notification.createMany({
        data: [{
          orgId,
          notificationObjectId: notificationObject.id,
          recipientUserId,
          batchKey,
          objectIds: [notificationObject.id],
          deliveryMode: noisyBundleCount >= MAX_NOISY_BUNDLES_PER_RECIPIENT ? 'digest' : 'batched',
          readAt: null,
          archivedAt: null,
          snoozedUntil: null,
        }],
        skipDuplicates: true,
      })
    }
  } else {
    await tx.notification.createMany({
      data: validRecipientUserIds.map((recipientUserId) => ({
        orgId,
        notificationObjectId: notificationObject.id,
        recipientUserId,
        batchKey: notificationBatchKey(recipientUserId, verb, `${objectType}:${objectId}`),
        objectIds: [notificationObject.id],
        deliveryMode: 'immediate',
        readAt: null,
        archivedAt: null,
        snoozedUntil: null,
      })),
      skipDuplicates: true,
    })
  }

  return {
    notificationObjectId: notificationObject.id,
    recipientUserIds: validRecipientUserIds,
    rejectedRecipientUserIds,
  }
}
