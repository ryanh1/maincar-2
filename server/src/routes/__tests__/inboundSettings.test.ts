import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    inboundForwarding: { findUnique: vi.fn(), upsert: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/settings/inbound`
const AUTH = 'Bearer token'

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    org: { id: ORG_ID, enabled: true },
  })
  prismaMock.inboundForwarding.findUnique.mockResolvedValue(null)
  prismaMock.inboundForwarding.upsert.mockResolvedValue({
    orgId: ORG_ID, userId: 'user-a', enabled: true, mobileE164: '+12025550188', strategy: 'simultaneous',
  })
})

describe('inbound forwarding settings', () => {
  it('returns safe disabled defaults when the rep has not configured forwarding', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ inboundForwarding: { enabled: false, mobileE164: null, strategy: 'simultaneous' } })
    expect(prismaMock.inboundForwarding.findUnique).toHaveBeenCalledWith({
      where: { orgId_userId: { orgId: ORG_ID, userId: 'user-a' } },
    })
  })

  it('validates E.164 before enabling the mobile forwarding leg', async () => {
    const response = await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ enabled: true, mobileE164: '202-555-0188', strategy: 'simultaneous' })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Enter a valid E.164 mobile number.' })
    expect(prismaMock.inboundForwarding.upsert).not.toHaveBeenCalled()
  })

  it('stores the rep’s mobile and browser-fallback strategy', async () => {
    const response = await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ enabled: true, mobileE164: '+12025550188', strategy: 'browser_fallback' })

    expect(response.status).toBe(200)
    expect(prismaMock.inboundForwarding.upsert).toHaveBeenCalledWith({
      where: { orgId_userId: { orgId: ORG_ID, userId: 'user-a' } },
      create: { orgId: ORG_ID, userId: 'user-a', enabled: true, mobileE164: '+12025550188', strategy: 'browser_fallback' },
      update: { enabled: true, mobileE164: '+12025550188', strategy: 'browser_fallback' },
    })
  })

  it('disables forwarding without deleting the saved mobile number', async () => {
    await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ enabled: false, mobileE164: '+12025550188', strategy: 'simultaneous' })

    expect(prismaMock.inboundForwarding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ enabled: false, mobileE164: '+12025550188' }) }),
    )
  })
})
