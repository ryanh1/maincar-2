import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), update: vi.fn() } },
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
const URL = '/api/notification-delivery-settings'
const settings = {
  channels: {
    in_app: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    email: { timing: 'digest', digestFrequency: 'daily', digestTime: '17:00' },
    push: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    slack: { timing: 'off', digestFrequency: 'hourly', digestTime: '09:00' },
  },
  quietHours: { enabled: true, startTime: '18:00', endTime: '08:00' },
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true, notificationDeliverySettings: null,
  })
  prismaMock.user.update.mockResolvedValue({ id: 'user-a' })
})

describe('notification delivery settings', () => {
  it('returns a safe per-channel default schedule before the rep saves settings', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.notificationDeliverySettings).toEqual({
      channels: {
        in_app: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
        email: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
        push: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
        slack: { timing: 'off', digestFrequency: 'hourly', digestTime: '09:00' },
      },
      quietHours: { enabled: false, startTime: '18:00', endTime: '08:00' },
    })
  })

  it('persists every channel schedule and the quiet-hours window for its owner', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({ notificationDeliverySettings: settings })

    expect(response.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' }, data: { notificationDeliverySettings: settings },
    })
    expect(response.body).toEqual({ notificationDeliverySettings: settings })
  })

  it('rejects an attempt to turn the durable inbox off', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({
      notificationDeliverySettings: { ...settings, channels: { ...settings.channels, in_app: { ...settings.channels.in_app, timing: 'off' } } },
    })

    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})
