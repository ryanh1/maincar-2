import { describe, expect, it, vi } from 'vitest'

import {
  NotificationEventError,
  fanOutNotification,
  type NotificationWriterClient,
} from '../notifications.js'

function fakeClient(opts: {
  actorIsMember?: boolean
  activeRecipientIds?: string[]
  objectId?: string
} = {}) {
  const findMany = vi.fn(async () => {
    const memberIds = [
      ...(opts.actorIsMember === false ? [] : ['actor-1']),
      ...(opts.activeRecipientIds ?? ['recipient-1', 'recipient-2']),
    ]
    return memberIds.map((userId) => ({ userId }))
  })
  const upsert = vi.fn(async () => ({ id: opts.objectId ?? 'notification-object-1' }))
  const createMany = vi.fn(async () => ({ count: 2 }))
  const tx = {
    membership: { findMany },
    notificationObject: { upsert },
    notification: { createMany },
  }
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => unknown) =>
    callback(tx),
  )

  return {
    client: { $transaction: transaction } as unknown as NotificationWriterClient,
    findMany,
    upsert,
    createMany,
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
          readAt: null,
          archivedAt: null,
          snoozedUntil: null,
        },
        {
          orgId: 'org-1',
          notificationObjectId: 'notification-object-1',
          recipientUserId: 'recipient-2',
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
})
