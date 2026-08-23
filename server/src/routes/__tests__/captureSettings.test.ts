import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    captureSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    mailCaptureOptOut: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/settings/capture`
const AUTH = 'Bearer token'
const NOW = new Date('2026-08-22T12:00:00.000Z')

function orgRow() {
  return { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW }
}

function membershipRow(roles: string[] = ['admin']) {
  return {
    id: 'membership-a',
    userId: 'user-a',
    orgId: ORG_ID,
    roles,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    org: orgRow(),
  }
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings-a',
    orgId: ORG_ID,
    internalDomains: [],
    allowDomains: [],
    excludeDomains: [],
    excludeAddresses: [],
    excludeRoleAddresses: true,
    dropBulkInbound: true,
    bulkInboundMax: 15,
    subjectExcludes: [],
    logActivityTypes: 'both',
    backfillMonths: 12,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const FULL_SETTINGS = {
  internalDomains: ['ourco.com'],
  allowDomains: [],
  excludeDomains: ['spam.com'],
  excludeAddresses: ['jane@ourco.com'],
  excludeRoleAddresses: true,
  dropBulkInbound: true,
  bulkInboundMax: 20,
  subjectExcludes: ['newsletter'],
  logActivityTypes: 'both',
  backfillMonths: 6,
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@example.com',
    enabled: true,
  })
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.captureSettings.findUnique.mockResolvedValue(null)
  prismaMock.mailCaptureOptOut.findUnique.mockResolvedValue(null)
  prismaMock.captureSettings.upsert.mockResolvedValue(settingsRow(FULL_SETTINGS))
  prismaMock.mailCaptureOptOut.upsert.mockResolvedValue({ id: 'opt-a', orgId: ORG_ID, userId: 'user-a' })
  prismaMock.mailCaptureOptOut.deleteMany.mockResolvedValue({ count: 1 })
})

describe('capture settings', () => {
  it('returns the safe defaults when no settings row exists yet', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      captureSettings: {
        internalDomains: [],
        allowDomains: [],
        excludeDomains: [],
        excludeAddresses: [],
        excludeRoleAddresses: true,
        dropBulkInbound: true,
        bulkInboundMax: 15,
        subjectExcludes: [],
        logActivityTypes: 'both',
        backfillMonths: 12,
      },
      optedOut: false,
    })
  })

  it('reports the caller opted out when their row exists', async () => {
    prismaMock.mailCaptureOptOut.findUnique.mockResolvedValue({ id: 'opt-a', orgId: ORG_ID, userId: 'user-a' })

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.body.optedOut).toBe(true)
  })

  it('refuses a non-admin settings write', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow(['basic']))

    const response = await request(app).patch(URL).set('Authorization', AUTH).send(FULL_SETTINGS)

    expect(response.status).toBe(403)
    expect(prismaMock.captureSettings.upsert).not.toHaveBeenCalled()
  })

  it('upserts the settings and returns them', async () => {
    const response = await request(app).patch(URL).set('Authorization', AUTH).send(FULL_SETTINGS)

    expect(response.status).toBe(200)
    expect(prismaMock.captureSettings.upsert).toHaveBeenCalledWith({
      where: { orgId: ORG_ID },
      create: { orgId: ORG_ID, ...FULL_SETTINGS },
      update: FULL_SETTINGS,
    })
    expect(response.body.captureSettings.bulkInboundMax).toBe(20)
  })

  it('rejects an invalid back-fill window', async () => {
    const response = await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ ...FULL_SETTINGS, backfillMonths: 9 })

    expect(response.status).toBe(400)
    expect(prismaMock.captureSettings.upsert).not.toHaveBeenCalled()
  })

  it('rejects an invalid what-to-log value', async () => {
    const response = await request(app)
      .patch(URL)
      .set('Authorization', AUTH)
      .send({ ...FULL_SETTINGS, logActivityTypes: 'calls' })

    expect(response.status).toBe(400)
  })

  it('lets a member opt their own mailbox out', async () => {
    const response = await request(app)
      .put(`${URL}/opt-out`)
      .set('Authorization', AUTH)
      .send({ optedOut: true })

    expect(response.status).toBe(200)
    expect(prismaMock.mailCaptureOptOut.upsert).toHaveBeenCalledWith({
      where: { orgId_userId: { orgId: ORG_ID, userId: 'user-a' } },
      create: { orgId: ORG_ID, userId: 'user-a' },
      update: {},
    })
    expect(response.body).toEqual({ optedOut: true })
  })

  it('lets a member opt back in by deleting their row', async () => {
    const response = await request(app)
      .put(`${URL}/opt-out`)
      .set('Authorization', AUTH)
      .send({ optedOut: false })

    expect(response.status).toBe(200)
    expect(prismaMock.mailCaptureOptOut.deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, userId: 'user-a' },
    })
  })
})
