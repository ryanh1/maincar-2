import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    emailSignature: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailDraft: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    emailTemplate: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: vi.fn(),
}))

import app from '../../app.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_ID = 'org-a'
const USER_ID = 'user-a'
const URL = `/api/email/orgs/${ORG_ID}/signatures`

function userRow() {
  return {
    id: USER_ID,
    firebaseUid: 'uid-a',
    email: 'rep@acme.test',
    firstName: 'Ari',
    lastName: 'Rep',
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: 'America/New_York',
    currentOrgId: ORG_ID,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function membershipRow() {
  return {
    id: 'membership-a',
    userId: USER_ID,
    orgId: ORG_ID,
    roles: ['basic'],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_ID, name: 'Acme', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function signatureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'signature-a',
    userId: USER_ID,
    name: 'Work',
    bodyHtml: '<p>Ari Rep</p>',
    isDefault: false,
    defaultForUser: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'rep@acme.test' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.emailSignature.findMany.mockResolvedValue([])
  prismaMock.emailSignature.findFirst.mockResolvedValue(signatureRow())
  prismaMock.emailSignature.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    signatureRow(data),
  )
  prismaMock.emailSignature.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.emailSignature.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation(async (operation: (tx: typeof prismaMock) => unknown) => operation(prismaMock))
})

describe('email signature routes', () => {
  it('lists only the signed-in rep’s signatures, with the default first', async () => {
    prismaMock.emailSignature.findMany.mockResolvedValue([signatureRow({ isDefault: true, defaultForUser: USER_ID })])

    const res = await request(app).get(URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.signatures).toHaveLength(1)
    expect(prismaMock.emailSignature.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      take: 200,
    })
  })

  it('creates a sanitized default signature for the signed-in rep', async () => {
    const res = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .send({ name: 'Work', bodyHtml: '<p>Ari</p><script>alert(1)</script>', isDefault: true, userId: 'user-b' })

    expect(res.status).toBe(201)
    expect(res.body.signature.bodyHtml).toBe('<p>Ari</p>')
    expect(prismaMock.emailSignature.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { isDefault: false, defaultForUser: null },
    })
    expect(prismaMock.emailSignature.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        name: 'Work',
        bodyHtml: '<p>Ari</p>',
        isDefault: true,
        defaultForUser: USER_ID,
      },
    })
  })

  it('makes a selected signature the only default for the current rep', async () => {
    const res = await request(app)
      .patch(`${URL}/signature-a`)
      .set('Authorization', AUTH)
      .send({ isDefault: true })

    expect(res.status).toBe(200)
    expect(prismaMock.emailSignature.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { not: 'signature-a' } },
      data: { isDefault: false, defaultForUser: null },
    })
    expect(prismaMock.emailSignature.updateMany).toHaveBeenCalledWith({
      where: { id: 'signature-a', userId: USER_ID },
      data: { isDefault: true, defaultForUser: USER_ID },
    })
  })

  it('updates and deletes only a signature the signed-in rep owns', async () => {
    await request(app).patch(`${URL}/signature-a`).set('Authorization', AUTH).send({ name: 'Personal' })
    expect(prismaMock.emailSignature.updateMany).toHaveBeenCalledWith({
      where: { id: 'signature-a', userId: USER_ID },
      data: { name: 'Personal' },
    })

    const res = await request(app).delete(`${URL}/signature-a`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.emailSignature.deleteMany).toHaveBeenCalledWith({
      where: { id: 'signature-a', userId: USER_ID },
    })
  })
})
