import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.hoisted(() => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'BEl5R6jL4mE4DNL3E0Cq3kS2EgbZv2vOFdSPmHhSUxe7m6XzK0sv4FvR6iJZ2BzWg'
})

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    webPushSubscription: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
const subscription = {
  endpoint: 'https://push.example.test/subscription-1',
  keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true })
  prismaMock.webPushSubscription.findUnique.mockResolvedValue(null)
  prismaMock.webPushSubscription.create.mockResolvedValue({ id: 'subscription-a', userId: 'user-a', ...subscription })
  prismaMock.webPushSubscription.deleteMany.mockResolvedValue({ count: 1 })
})

describe('web push subscriptions', () => {
  it('returns the public VAPID key only to an authenticated rep', async () => {
    const response = await request(app).get('/api/web-push/vapid-key').set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ webPushVapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY })
  })

  it('registers a subscription only for the authenticated rep', async () => {
    const response = await request(app).put('/api/web-push/subscriptions').set('Authorization', AUTH).send({ subscription })

    expect(response.status).toBe(200)
    expect(prismaMock.webPushSubscription.create).toHaveBeenCalledWith({
      data: { userId: 'user-a', endpoint: subscription.endpoint, p256dh: 'p256dh-key', auth: 'auth-key' },
    })
    expect(response.body).toEqual({ webPushSubscription: { endpoint: subscription.endpoint } })
  })

  it('refuses to attach a browser subscription already owned by a different rep', async () => {
    prismaMock.webPushSubscription.findUnique.mockResolvedValue({ userId: 'user-b' })

    const response = await request(app).put('/api/web-push/subscriptions').set('Authorization', AUTH).send({ subscription })

    expect(response.status).toBe(409)
    expect(prismaMock.webPushSubscription.create).not.toHaveBeenCalled()
    expect(prismaMock.webPushSubscription.update).not.toHaveBeenCalled()
  })

  it('renews an existing subscription owned by the authenticated rep', async () => {
    prismaMock.webPushSubscription.findUnique.mockResolvedValue({ endpoint: subscription.endpoint, userId: 'user-a' })

    const response = await request(app).put('/api/web-push/subscriptions').set('Authorization', AUTH).send({ subscription })

    expect(response.status).toBe(200)
    expect(prismaMock.webPushSubscription.update).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint },
      data: { p256dh: 'p256dh-key', auth: 'auth-key' },
    })
  })

  it('revokes only the authenticated rep’s subscription', async () => {
    const response = await request(app).delete('/api/web-push/subscriptions').set('Authorization', AUTH).send({ endpoint: subscription.endpoint })

    expect(response.status).toBe(204)
    expect(prismaMock.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint, userId: 'user-a' },
    })
  })
})
