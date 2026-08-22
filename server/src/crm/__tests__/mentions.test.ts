import { describe, expect, it, vi } from 'vitest'

import {
  extractTipTapMentionUserIds,
  resolveNewTeammateMentions,
  resolveNotificationDestination,
  resolveTeammateMentions,
  type MentionResolverClient,
  type NotificationDestinationClient,
} from '../mentions.js'

const documentWith = (...ids: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Please review ' },
        ...ids.map((id) => ({ type: 'mention', attrs: { id, label: `Teammate ${id}` } })),
      ],
    },
  ],
})

function fakeMentionClient(activeUserIds: string[]) {
  const findMany = vi.fn(async () => activeUserIds.map((userId) => ({ userId })))

  return {
    client: { membership: { findMany } } as unknown as MentionResolverClient,
    findMany,
  }
}

function fakeDestinationClient(opts: {
  viewerIsActive?: boolean
  callExists?: boolean
} = {}) {
  const membershipFindFirst = vi.fn(async () => (opts.viewerIsActive === false ? null : { userId: 'viewer-1' }))
  const callFindFirst = vi.fn(async () => (opts.callExists === false ? null : { id: 'call-1' }))

  return {
    client: {
      membership: { findFirst: membershipFindFirst },
      call: { findFirst: callFindFirst },
    } as unknown as NotificationDestinationClient,
    membershipFindFirst,
    callFindFirst,
  }
}

describe('TipTap teammate mentions', () => {
  it('extracts unique IDs from structured mention nodes without treating plain @ text as a mention', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '@not-a-mention' },
            { type: 'mention', attrs: { id: 'member-1' } },
            { type: 'mention', attrs: { id: 'member-1' } },
            { type: 'mention', attrs: { id: 'member-2' } },
          ],
        },
      ],
    }

    expect(extractTipTapMentionUserIds(document)).toEqual(['member-1', 'member-2'])
  })

  it('resolves only active members of the source org and rejects forged, foreign, and inactive IDs', async () => {
    const { client, findMany } = fakeMentionClient(['member-1'])

    await expect(
      resolveTeammateMentions(client, {
        orgId: 'org-1',
        content: documentWith('member-1', 'foreign-user', 'inactive-user'),
      }),
    ).resolves.toEqual({
      recipientUserIds: ['member-1'],
      rejectedUserIds: ['foreign-user', 'inactive-user'],
    })

    expect(findMany).toHaveBeenCalledWith({
      where: {
        orgId: 'org-1',
        isActive: true,
        userId: { in: ['member-1', 'foreign-user', 'inactive-user'] },
      },
      select: { userId: true },
    })
  })

  it('resolves only newly added active mention recipients when editing content', async () => {
    const { client } = fakeMentionClient(['member-1', 'member-2'])

    await expect(
      resolveNewTeammateMentions(client, {
        orgId: 'org-1',
        previousContent: documentWith('member-1'),
        content: documentWith('member-1', 'member-2', 'foreign-user'),
      }),
    ).resolves.toEqual({
      recipientUserIds: ['member-2'],
      rejectedUserIds: ['foreign-user'],
    })
  })
})

describe('notification destinations', () => {
  it('resolves an accessible call target to its typed client route', async () => {
    const { client, membershipFindFirst, callFindFirst } = fakeDestinationClient()

    await expect(
      resolveNotificationDestination(client, {
        orgId: 'org-1',
        viewerUserId: 'viewer-1',
        target: { objectType: 'call', objectId: 'call-1' },
      }),
    ).resolves.toEqual({ kind: 'available', path: '/calls/call-1' })

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { orgId: 'org-1', userId: 'viewer-1', isActive: true },
      select: { userId: true },
    })
    expect(callFindFirst).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: 'org-1' },
      select: { id: true },
    })
  })

  it('returns the safe unavailable state for inactive viewers, missing sources, and unknown types', async () => {
    const inactiveViewer = fakeDestinationClient({ viewerIsActive: false })
    const missingCall = fakeDestinationClient({ callExists: false })
    const unknownTarget = fakeDestinationClient()

    await expect(
      resolveNotificationDestination(inactiveViewer.client, {
        orgId: 'org-1', viewerUserId: 'viewer-1', target: { objectType: 'call', objectId: 'call-1' },
      }),
    ).resolves.toEqual({ kind: 'unavailable' })
    expect(inactiveViewer.callFindFirst).not.toHaveBeenCalled()

    await expect(
      resolveNotificationDestination(missingCall.client, {
        orgId: 'org-1', viewerUserId: 'viewer-1', target: { objectType: 'call', objectId: 'missing-call' },
      }),
    ).resolves.toEqual({ kind: 'unavailable' })

    await expect(
      resolveNotificationDestination(unknownTarget.client, {
        orgId: 'org-1', viewerUserId: 'viewer-1', target: { objectType: 'future_target', objectId: 'target-1' },
      }),
    ).resolves.toEqual({ kind: 'unavailable' })
    expect(unknownTarget.callFindFirst).not.toHaveBeenCalled()
  })
})
