import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, getSyncHealthReportMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  verifyTokenMock: vi.fn(),
  getSyncHealthReportMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../lib/syncHealth.js', () => ({ getSyncHealthReport: getSyncHealthReportMock }))

import app from '../../app.js'

const URL = '/api/admin/sync-health'

function userRow(roles: string[]) {
  return {
    id: 'user-1', firebaseUid: 'uid-1', email: 'admin@maincar.test', firstName: 'Admin', lastName: 'User',
    roles, enabled: true, timeZone: 'America/New_York', callAlertSettings: null, notificationDeliverySettings: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-1' })
  prismaMock.user.findUnique.mockResolvedValue(userRow(['superadmin']))
  getSyncHealthReportMock.mockResolvedValue({ generatedAt: '2026-08-24T00:00:00.000Z' })
})

describe('GET /api/admin/sync-health', () => {
  it('returns the cross-tenant health report to a platform superadmin', async () => {
    const response = await request(app).get(URL).set('Authorization', 'Bearer token')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ syncHealth: { generatedAt: '2026-08-24T00:00:00.000Z' } })
  })

  it('hides the operator endpoint from a normal signed-in user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow(['basic']))

    const response = await request(app).get(URL).set('Authorization', 'Bearer token')

    expect(response.status).toBe(404)
    expect(getSyncHealthReportMock).not.toHaveBeenCalled()
  })
})
