import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    nextStepType: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    dispositionDef: { findFirst: vi.fn() },
    dispositionNextStepRule: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/next-steps`
const NOW = new Date('2026-08-23T00:00:00.000Z')

function typeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'next-step-1', orgId: ORG_ID, value: 'callback', label: 'Callback', color: 'option-3', icon: 'PhoneCall',
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
  prismaMock.nextStepType.findMany.mockResolvedValue([typeRow()])
  prismaMock.nextStepType.findFirst.mockResolvedValue(null)
  prismaMock.nextStepType.create.mockResolvedValue(typeRow({
    id: 'next-step-2', value: 'send_email', label: 'Send email', color: 'option-2', icon: 'Mail',
    isPinned: false, pinOrder: null, requiresDateTime: false, createsTask: true,
  }))
  prismaMock.nextStepType.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.dispositionDef.findFirst.mockResolvedValue({ id: 'disposition-1' })
  prismaMock.dispositionNextStepRule.findMany.mockResolvedValue([])
  prismaMock.dispositionNextStepRule.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.dispositionNextStepRule.create.mockResolvedValue({ id: 'rule-1' })
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
})

describe('next-step types and suggestion rules', () => {
  it('creates a stable, task-creating callback type with its behavior flags', async () => {
    const response = await request(app).post('/api/orgs/org-a/next-steps/types').set('Authorization', AUTH).send({
      value: 'send_email', label: 'Send email', color: 'option-2', icon: 'Mail', createsTask: true,
    })

    expect(response.status).toBe(201)
    expect(response.body.type).toEqual(expect.objectContaining({ value: 'send_email', createsTask: true, requiresDateTime: false }))
    expect(prismaMock.nextStepType.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: ORG_ID, value: 'send_email', createsTask: true, requiresDateTime: false, isOverflow: false }),
    })
  })

  it('refuses an archived next-step type when saving a disposition suggestion', async () => {
    prismaMock.nextStepType.findFirst.mockResolvedValue(null)

    const response = await request(app).put(`${URL}/rules/disposition-1`).set('Authorization', AUTH).send({ nextStepTypeId: 'archived-step' })

    expect(response.status).toBe(400)
    expect(prismaMock.dispositionNextStepRule.create).not.toHaveBeenCalled()
  })

  it('never exposes types to someone outside the organization', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const response = await request(app).get(`${URL}/types`).set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.nextStepType.findMany).not.toHaveBeenCalled()
  })
})
