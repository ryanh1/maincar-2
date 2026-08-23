import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    keyboardBinding: { findMany: vi.fn(), upsert: vi.fn() },
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

const AUTH = 'Bearer token'
beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@example.com',
    enabled: true,
  })
})

describe('keyboard bindings', () => {
  it('returns only the signed-in user’s overrides', async () => {
    prismaMock.keyboardBinding.findMany.mockResolvedValue([
      { actionId: 'compose-email', keys: 'G' },
    ])

    const response = await request(app).get('/api/keyboard-bindings').set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ bindings: [{ actionId: 'compose-email', keys: 'G' }] })
    expect(prismaMock.keyboardBinding.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      select: { actionId: true, keys: true },
      orderBy: { actionId: 'asc' },
    })
  })

  it('saves the signed-in user’s binding by action', async () => {
    prismaMock.keyboardBinding.upsert.mockResolvedValue({ actionId: 'compose-email', keys: 'G' })

    const response = await request(app)
      .put('/api/keyboard-bindings/compose-email')
      .set('Authorization', AUTH)
      .send({ keys: 'g' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ binding: { actionId: 'compose-email', keys: 'G' } })
    expect(prismaMock.keyboardBinding.upsert).toHaveBeenCalledWith({
      where: { userId_actionId: { userId: 'user-a', actionId: 'compose-email' } },
      create: { userId: 'user-a', actionId: 'compose-email', keys: 'G' },
      update: { keys: 'G' },
      select: { actionId: true, keys: true },
    })
  })

  it('refuses a bare letter for a destructive action', async () => {
    const response = await request(app)
      .put('/api/keyboard-bindings/delete-record')
      .set('Authorization', AUTH)
      .send({ keys: 'd' })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Use a modifier key for destructive actions.' })
    expect(prismaMock.keyboardBinding.upsert).not.toHaveBeenCalled()
  })
})
