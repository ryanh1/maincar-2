import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    notificationPreference: { findMany: vi.fn(), upsert: vi.fn() },
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

const AUTH = 'Bearer token'
const URL = '/api/notification-preferences'

const preferenceGrid = [
  { eventKind: 'mention', channel: 'in_app', enabled: true },
  { eventKind: 'mention', channel: 'email', enabled: true },
  { eventKind: 'mention', channel: 'push', enabled: true },
  { eventKind: 'mention', channel: 'slack', enabled: true },
  { eventKind: 'assignment', channel: 'in_app', enabled: true },
  { eventKind: 'assignment', channel: 'email', enabled: true },
  { eventKind: 'assignment', channel: 'push', enabled: true },
  { eventKind: 'assignment', channel: 'slack', enabled: true },
  { eventKind: 'comment', channel: 'in_app', enabled: true },
  { eventKind: 'comment', channel: 'email', enabled: false },
  { eventKind: 'comment', channel: 'push', enabled: false },
  { eventKind: 'comment', channel: 'slack', enabled: false },
  { eventKind: 'status_change', channel: 'in_app', enabled: true },
  { eventKind: 'status_change', channel: 'email', enabled: false },
  { eventKind: 'status_change', channel: 'push', enabled: false },
  { eventKind: 'status_change', channel: 'slack', enabled: false },
  { eventKind: 'team_broadcast', channel: 'in_app', enabled: true },
  { eventKind: 'team_broadcast', channel: 'email', enabled: false },
  { eventKind: 'team_broadcast', channel: 'push', enabled: false },
  { eventKind: 'team_broadcast', channel: 'slack', enabled: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true,
    roles: ['basic'], firstName: null, lastName: null, timeZone: 'America/New_York', callAlertSettings: null,
  })
  prismaMock.notificationPreference.findMany.mockResolvedValue([])
  prismaMock.notificationPreference.upsert.mockResolvedValue(undefined)
  prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations))
})

describe('notification preferences', () => {
  it('returns the grouped channel defaults before the rep saves preferences', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.notificationPreferences).toEqual(preferenceGrid)
  })

  it('uses a saved channel choice over the default for its owner', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([
      { eventKind: 'comment', channel: 'email', enabled: true },
    ])

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.notificationPreferences).toContainEqual({ eventKind: 'comment', channel: 'email', enabled: true })
  })

  it('persists each user-scoped event-kind and channel preference', async () => {
    const savedGrid = preferenceGrid.map((preference) =>
      preference.eventKind === 'comment' && preference.channel === 'email'
        ? { ...preference, enabled: true }
        : preference,
    )

    const response = await request(app).put(URL).set('Authorization', AUTH).send({ notificationPreferences: savedGrid })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ notificationPreferences: savedGrid })
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_eventKind_channel: { userId: 'user-a', eventKind: 'comment', channel: 'email' } },
      create: { userId: 'user-a', eventKind: 'comment', channel: 'email', enabled: true },
      update: { enabled: true },
    })
  })

  it('rejects a request that turns the in-app inbox off', async () => {
    const response = await request(app).put(URL).set('Authorization', AUTH).send({
      notificationPreferences: preferenceGrid.map((preference) =>
        preference.eventKind === 'mention' && preference.channel === 'in_app'
          ? { ...preference, enabled: false }
          : preference,
      ),
    })

    expect(response.status).toBe(400)
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled()
  })
})
