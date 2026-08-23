import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
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
const URL = '/api/call-alert-settings'

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true, callAlertSettings: null,
  })
  prismaMock.user.update.mockResolvedValue({ id: 'user-a' })
})

describe('call alert settings', () => {
  it('returns safe foreground defaults before a user saves settings', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.callAlertSettings).toMatchObject({
      incoming: { sound: true, popover: true },
      missed: { sound: false, popover: true },
      voicemail: { sound: false, popover: true },
      doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
    })
  })

  it('persists a complete user-scoped alert preference set', async () => {
    const callAlertSettings = {
      incoming: { sound: true, popover: false, browserNotification: true, desktopNotification: false },
      missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
      voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: true },
      ringSound: 'classic',
      volume: 0.4,
      doNotDisturb: { enabled: true, startTime: '22:00', endTime: '07:00' },
    }

    const response = await request(app).put(URL).set('Authorization', AUTH).send({ callAlertSettings })

    expect(response.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' }, data: { callAlertSettings },
    })
    expect(response.body).toEqual({ callAlertSettings })
  })

  it('rejects an invalid DND time without changing the stored settings', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({
      callAlertSettings: {
        incoming: { sound: true, popover: true, browserNotification: false, desktopNotification: false },
        missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
        voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
        ringSound: 'classic', volume: 0.8,
        doNotDisturb: { enabled: true, startTime: '26:00', endTime: '08:00' },
      },
    })

    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})
