import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    call: { findFirst: vi.fn() },
    nextStepType: { findMany: vi.fn() },
    callNextStep: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
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
const AUTH = 'Bearer token'
const URL = `/api/orgs/${ORG_ID}/calls/call-1/next-steps`
const NOW = new Date('2026-08-23T00:00:00.000Z')

function typeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'callback', orgId: ORG_ID, value: 'callback', label: 'Callback', color: 'option-3', icon: 'PhoneCall',
    isPinned: true, pinOrder: 0, sortOrder: 0, isOverflow: false, requiresDateTime: true, createsTask: true,
    isArchived: false, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    org: { id: ORG_ID, enabled: true }, createdAt: NOW, updatedAt: NOW,
  })
  prismaMock.call.findFirst.mockResolvedValue({ id: 'call-1' })
  prismaMock.nextStepType.findMany.mockResolvedValue([typeRow(), typeRow({ id: 'send_email', value: 'send_email', label: 'Send email', requiresDateTime: false, createsTask: false })])
  prismaMock.callNextStep.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.callNextStep.createMany.mockResolvedValue({ count: 2 })
  prismaMock.callNextStep.findMany.mockResolvedValue([
    { id: 'selection-1', scheduledAt: NOW, sortOrder: 0, nextStepType: typeRow() },
    { id: 'selection-2', scheduledAt: null, sortOrder: 1, nextStepType: typeRow({ id: 'send_email', value: 'send_email', label: 'Send email', requiresDateTime: false, createsTask: false }) },
  ])
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
})

describe('call next-step persistence', () => {
  it('atomically replaces a call’s selected next steps without changing its disposition', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({
      nextSteps: [
        { nextStepTypeId: 'callback', scheduledAt: NOW.toISOString() },
        { nextStepTypeId: 'send_email' },
      ],
    })

    expect(response.status).toBe(200)
    expect(response.body.nextSteps).toEqual([
      expect.objectContaining({ nextStepType: expect.objectContaining({ value: 'callback' }), scheduledAt: NOW.toISOString() }),
      expect.objectContaining({ nextStepType: expect.objectContaining({ value: 'send_email' }), scheduledAt: null }),
    ])
    expect(prismaMock.callNextStep.deleteMany).toHaveBeenCalledWith({ where: { callId: 'call-1', orgId: ORG_ID } })
    expect(prismaMock.callNextStep.createMany).toHaveBeenCalledWith({
      data: [
        { orgId: ORG_ID, callId: 'call-1', nextStepTypeId: 'callback', scheduledAt: NOW, sortOrder: 0 },
        { orgId: ORG_ID, callId: 'call-1', nextStepTypeId: 'send_email', scheduledAt: null, sortOrder: 1 },
      ],
    })
  })

  it('rejects a date-required type when its selected step has no scheduled instant', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({ nextSteps: [{ nextStepTypeId: 'callback' }] })

    expect(response.status).toBe(400)
    expect(prismaMock.callNextStep.deleteMany).not.toHaveBeenCalled()
  })
})
