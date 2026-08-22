import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    org: { updateMany: vi.fn(), findFirst: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import app from '../../app.js'

const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/settings/recording`
const AUTH = 'Bearer token'
const NOW = new Date('2026-08-22T12:00:00.000Z')

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: 'Org A',
    logo: null,
    enabled: true,
    recordCalls: true,
    recordingBlockedStates: ['CA', 'CT', 'UNKNOWN'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(roles: string[] = ['admin']) {
  return {
    id: 'membership-a',
    userId: 'user-a',
    orgId: ORG_ID,
    roles,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    org: orgRow(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@example.com',
    enabled: true,
  })
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.org.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.org.findFirst.mockResolvedValue(orgRow())
})

describe('recording policy settings', () => {
  it('lets an organization member read the policy defaults', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      recordingPolicy: {
        recordCalls: true,
        blockedStates: ['CA', 'CT', 'UNKNOWN'],
      },
    })
  })

  it('refuses a non-admin policy write', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow(['basic']))

    const response = await request(app).patch(URL).set('Authorization', AUTH).send({ recordCalls: false })

    expect(response.status).toBe(403)
    expect(prismaMock.org.updateMany).not.toHaveBeenCalled()
  })

  it('updates a single setting and normalizes the selected blocked-state set', async () => {
    await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ blockedStates: ['unknown', 'ny', 'CA', 'NY'] })

    expect(prismaMock.org.updateMany).toHaveBeenCalledWith({
      where: { id: ORG_ID, enabled: true },
      data: { recordingBlockedStates: ['CA', 'NY', 'UNKNOWN'] },
    })
  })

  it('rejects an invalid state code without writing', async () => {
    const response = await request(app).patch(URL).set('Authorization', AUTH).send({ blockedStates: ['ZZ'] })

    expect(response.status).toBe(400)
    expect(prismaMock.org.updateMany).not.toHaveBeenCalled()
  })
})
