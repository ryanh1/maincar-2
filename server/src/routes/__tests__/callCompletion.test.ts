import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    call: { findFirst: vi.fn(), updateMany: vi.fn() },
    dispositionDef: { findFirst: vi.fn() },
    nextStepType: { findMany: vi.fn() },
    callNextStep: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    task: { create: vi.fn() },
    recordLink: { deleteMany: vi.fn(), createMany: vi.fn() },
    activityEntry: { upsert: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/calls/call-1/complete`
const NOW = new Date('2026-08-23T15:00:00.000Z')

function nextStepType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'callback', orgId: ORG_ID, value: 'callback', label: 'Schedule callback', color: 'option-3', icon: 'PhoneCall',
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
  prismaMock.call.findFirst.mockResolvedValue({ id: 'call-1', personId: 'person-1', companyId: 'company-1', dealId: null, toE164: '+12025550123' })
  prismaMock.dispositionDef.findFirst.mockResolvedValue({ id: 'connected' })
  prismaMock.nextStepType.findMany.mockResolvedValue([nextStepType()])
  prismaMock.call.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.callNextStep.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.callNextStep.createMany.mockResolvedValue({ count: 1 })
  prismaMock.callNextStep.findMany.mockResolvedValue([{ id: 'step-1', scheduledAt: NOW, sortOrder: 0, nextStepType: nextStepType() }])
  prismaMock.task.create.mockResolvedValue({ id: 'task-1', orgId: ORG_ID, title: 'Schedule callback: +12025550123', body: null, type: 'call', priority: 'med', commitment: 'soft', assigneeUserId: 'user-a', dueAt: NOW, remindAt: NOW, eventId: null, origin: 'manual', isDone: false, doneAt: null, createdAt: NOW, updatedAt: NOW })
  prismaMock.activityEntry.upsert.mockResolvedValue({ id: 'activity-1' })
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
})

describe('call completion', () => {
  it('saves the disposition, note, next step, and linked callback task in one transaction', async () => {
    const response = await request(app).post(URL).set('Authorization', AUTH).send({
      dispositionId: 'connected',
      noteText: 'Asked to call Tuesday.',
      nextSteps: [{ nextStepTypeId: 'callback', scheduledAt: NOW.toISOString() }],
    })

    expect(response.status).toBe(200)
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_ID },
      data: { dispositionId: 'connected', noteText: 'Asked to call Tuesday.' },
    })
    expect(prismaMock.callNextStep.createMany).toHaveBeenCalledWith({
      data: [{ orgId: ORG_ID, callId: 'call-1', nextStepTypeId: 'callback', scheduledAt: NOW, sortOrder: 0 }],
    })
    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_ID, title: 'Schedule callback: +12025550123', type: 'call', assigneeUserId: 'user-a', dueAt: NOW, remindAt: NOW,
      }),
    })
    expect(prismaMock.recordLink.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-1', toObject: 'person', toId: 'person-1' }),
        expect.objectContaining({ taskId: 'task-1', toObject: 'company', toId: 'company-1' }),
      ]),
    })
    expect(response.body).toEqual({ nextSteps: [expect.objectContaining({ id: 'step-1' })], tasks: [expect.objectContaining({ id: 'task-1' })] })
  })

  it('rejects a callback without a scheduled time before starting the transaction', async () => {
    const response = await request(app).post(URL).set('Authorization', AUTH).send({
      dispositionId: 'connected', nextSteps: [{ nextStepTypeId: 'callback' }],
    })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
