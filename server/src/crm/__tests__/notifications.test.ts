import { describe, expect, it, vi } from 'vitest'

import {
  NotificationEventError,
  fanOutNotification,
  type NotificationWriterClient,
} from '../notifications.js'

function fakeClient(opts: {
  actorIsMember?: boolean
  activeRecipientIds?: string[]
  createdRecipientCount?: number
  objectId?: string
  existingBundle?: {
    id: string
    notificationObjectId: string
    objectIds: string[]
    deliveryMode: string
    notificationObject?: { verb: string }
  } | null
  noisyBundleCount?: number
} = {}) {
  const findMany = vi.fn(async () => {
    const memberIds = [
      ...(opts.actorIsMember === false ? [] : ['actor-1']),
      ...(opts.activeRecipientIds ?? ['recipient-1', 'recipient-2']),
    ]
    return memberIds.map((userId) => ({ userId }))
  })
  const upsert = vi.fn(async () => ({ id: opts.objectId ?? 'notification-object-1' }))
  const createMany = vi.fn(async () => ({ count: opts.createdRecipientCount ?? 2 }))
  const findFirst = vi.fn(async () => opts.existingBundle ?? null)
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const count = vi.fn(async () => opts.noisyBundleCount ?? 0)
  const executeRaw = vi.fn(async () => undefined)
  const tx = {
    membership: { findMany },
    notificationObject: { upsert },
    notification: { createMany, findFirst, updateMany, count },
    $executeRaw: executeRaw,
  }
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => unknown) =>
    callback(tx),
  )

  return {
    client: { $transaction: transaction } as unknown as NotificationWriterClient,
    findMany,
    upsert,
    createMany,
    findFirst,
    updateMany,
    count,
    executeRaw,
  }
}

const event = {
  orgId: 'org-1',
  eventKey: 'call-comment:comment-1:mentions:v1',
  actorUserId: 'actor-1',
  verb: 'mentioned',
  object: {
    type: 'call_comment',
    id: 'comment-1',
    sourceSnapshot: { title: 'Comment on Acme discovery call', preview: 'Can you take this?' },
  },
  recipientUserIds: ['recipient-1', 'recipient-2'],
}

describe('fanOutNotification', () => {
  it('creates one object and one unread, active recipient row for each valid recipient', async () => {
    const { client, findMany, upsert, createMany } = fakeClient()

    const result = await fanOutNotification(client, event)

    expect(result).toEqual({
      notificationObjectId: 'notification-object-1',
      recipientUserIds: ['recipient-1', 'recipient-2'],
      rejectedRecipientUserIds: [],
    })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        orgId: 'org-1',
        isActive: true,
        userId: { in: ['actor-1', 'recipient-1', 'recipient-2'] },
      },
      select: { userId: true },
    })
    expect(upsert).toHaveBeenCalledWith({
      where: {
        orgId_eventKey: { orgId: 'org-1', eventKey: 'call-comment:comment-1:mentions:v1' },
      },
      create: {
        orgId: 'org-1',
        eventKey: 'call-comment:comment-1:mentions:v1',
        actorUserId: 'actor-1',
        verb: 'mentioned',
        objectType: 'call_comment',
        objectId: 'comment-1',
        sourceSnapshot: { title: 'Comment on Acme discovery call', preview: 'Can you take this?' },
      },
      update: {},
      select: { id: true },
    })
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: 'org-1',
          notificationObjectId: 'notification-object-1',
          recipientUserId: 'recipient-1',
          batchKey: 'recipient-1:mentioned:call_comment:comment-1',
          objectIds: ['notification-object-1'],
          deliveryMode: 'immediate',
          readAt: null,
          archivedAt: null,
          snoozedUntil: null,
        },
        {
          orgId: 'org-1',
          notificationObjectId: 'notification-object-1',
          recipientUserId: 'recipient-2',
          batchKey: 'recipient-2:mentioned:call_comment:comment-1',
          objectIds: ['notification-object-1'],
          deliveryMode: 'immediate',
          readAt: null,
          archivedAt: null,
          snoozedUntil: null,
        },
      ],
      skipDuplicates: true,
    })
  })

  it('suppresses the actor and rejects foreign or inactive recipients', async () => {
    const { client, createMany } = fakeClient({ activeRecipientIds: ['recipient-1'] })

    const result = await fanOutNotification(client, {
      ...event,
      recipientUserIds: ['actor-1', 'recipient-1', 'foreign-user', 'recipient-1'],
    })

    expect(result.recipientUserIds).toEqual(['recipient-1'])
    expect(result.rejectedRecipientUserIds).toEqual(['foreign-user'])
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ recipientUserId: 'recipient-1' })],
      }),
    )
  })

  it('does not create a recipient row when every requested recipient is suppressed or invalid', async () => {
    const { client, createMany } = fakeClient({ activeRecipientIds: [] })

    const result = await fanOutNotification(client, {
      ...event,
      recipientUserIds: ['actor-1', 'foreign-user'],
    })

    expect(result.recipientUserIds).toEqual([])
    expect(result.rejectedRecipientUserIds).toEqual(['foreign-user'])
    expect(createMany).not.toHaveBeenCalled()
  })

  it('returns a snoozed notification when new activity arrives for its source without changing read or archive state', async () => {
    const { client, updateMany } = fakeClient()

    await fanOutNotification(client, event)

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        orgId: 'org-1',
        recipientUserId: { in: ['recipient-1', 'recipient-2'] },
        snoozedUntil: { not: null },
        notificationObject: { is: { objectType: 'call_comment', objectId: 'comment-1' } },
      },
      data: { snoozedUntil: null },
    })
  })

  it('does not return snoozed notifications when a durable event is retried', async () => {
    const { client, updateMany } = fakeClient({ createdRecipientCount: 0 })

    await fanOutNotification(client, event)

    expect(updateMany).not.toHaveBeenCalled()
  })

  it('refuses an actor who is not an active member of the event org', async () => {
    const { client } = fakeClient({ actorIsMember: false })

    await expect(fanOutNotification(client, event)).rejects.toThrow(NotificationEventError)
  })

  it('refuses unsafe source snapshots and unvalidated event strings', async () => {
    const { client } = fakeClient()

    await expect(
      fanOutNotification(client, {
        ...event,
        verb: ' ',
      }),
    ).rejects.toThrow('verb')
    await expect(
      fanOutNotification(client, {
        ...event,
        object: { ...event.object, sourceSnapshot: { title: '<script>alert(1)</script>' } },
      }),
    ).rejects.toThrow('source snapshot')
  })

  it('folds a noisy bulk event into its active recipient bundle', async () => {
    const { client, findFirst, updateMany, createMany, executeRaw } = fakeClient({
      objectId: 'notification-object-50',
      existingBundle: {
        id: 'bundle-1',
        notificationObjectId: 'notification-object-1',
        objectIds: ['notification-object-1'],
        deliveryMode: 'batched',
      },
    })

    await fanOutNotification(client, {
      ...event,
      eventKey: 'bulk-stage-change:run-1:deal-50',
      verb: 'status_change',
      batchKey: 'bulk-stage-change:run-1:won',
      object: { ...event.object, type: 'deal', id: 'deal-50' },
      recipientUserIds: ['recipient-1'],
    })

    expect(executeRaw).toHaveBeenCalledOnce()
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        orgId: 'org-1',
        recipientUserId: 'recipient-1',
        batchKey: 'recipient-1:status_change:bulk-stage-change:run-1:won',
      }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bundle-1', orgId: 'org-1' }),
      data: expect.objectContaining({ objectIds: { push: 'notification-object-50' } }),
    }))
    expect(createMany).not.toHaveBeenCalled()
  })

  it('forces a fresh noisy bundle into digest delivery once the recipient reaches the storm cap', async () => {
    const { client, count, createMany } = fakeClient({ noisyBundleCount: 20 })

    await fanOutNotification(client, {
      ...event,
      eventKey: 'comment:storm-21',
      verb: 'comment',
      batchKey: 'comment-thread:call-1',
      recipientUserIds: ['recipient-1'],
    })

    expect(count).toHaveBeenCalledOnce()
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        batchKey: 'recipient-1:comment:comment-thread:call-1',
        objectIds: ['notification-object-1'],
        deliveryMode: 'digest',
      })],
    }))
  })

  it('upgrades a same-action mention bundle to its higher-priority assignment', async () => {
    const { client, findFirst, updateMany } = fakeClient({
      objectId: 'assignment-object',
      existingBundle: {
        id: 'action-bundle',
        notificationObjectId: 'mention-object',
        objectIds: ['mention-object'],
        deliveryMode: 'immediate',
        notificationObject: { verb: 'mention' },
      },
    })

    await fanOutNotification(client, {
      ...event,
      eventKey: 'task:task-1:assignment:v1',
      dedupeKey: 'task-action-1',
      verb: 'assignment',
      object: { ...event.object, type: 'task', id: 'task-1' },
      recipientUserIds: ['recipient-1'],
    })

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        batchKey: { in: ['recipient-1:mention:task-action-1', 'recipient-1:assignment:task-action-1'] },
      }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'action-bundle', orgId: 'org-1' }),
      data: expect.objectContaining({
        notificationObjectId: 'assignment-object',
        batchKey: 'recipient-1:assignment:task-action-1',
        objectIds: { push: 'assignment-object' },
      }),
    }))
  })

  it('requires an explicit server-derived group key for noisy events', async () => {
    const { client } = fakeClient()

    await expect(fanOutNotification(client, {
      ...event,
      eventKey: 'comment:thread-1',
      verb: 'comment',
      recipientUserIds: ['recipient-1'],
    })).rejects.toThrow('batchKey is required for noisy notification events.')
  })
})
