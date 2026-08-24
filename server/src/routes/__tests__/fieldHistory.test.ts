// Route tests for /api/orgs/:orgId/field-history (MAI-330).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    membership: { findFirst: vi.fn() },
    fieldHistory: { findMany: vi.fn() },
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

const NOW = new Date('2026-08-22T18:30:00.000Z')
const CHANGED_AT = new Date('2026-08-21T09:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/field-history`

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a', userId: 'user-a', orgId: ORG_A, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'history-1', orgId: ORG_A, objectSlug: 'person', recordId: 'person-1', attribute: 'title',
    oldJson: 'SDR', newJson: 'AE', changedByUserId: 'user-a', changeSource: 'user', reason: null,
    changedAt: CHANGED_AT, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.user.findMany.mockResolvedValue([userRow()])
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.fieldHistory.findMany.mockResolvedValue([historyRow()])
})

describe('GET /api/orgs/:orgId/field-history — membership and validation', () => {
  it('404s a non-member before reading field history', async () => {
    authAs(null)

    const res = await request(app)
      .get(`/api/orgs/${ORG_B}/field-history?recordId=person-1&attribute=title`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
    expect(prismaMock.fieldHistory.findMany).not.toHaveBeenCalled()
  })

  it('rejects a missing record or attribute before reading', async () => {
    const res = await request(app).get(`${URL_A}?recordId=person-1`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.fieldHistory.findMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid cursor rather than silently restarting the history', async () => {
    const res = await request(app)
      .get(`${URL_A}?recordId=person-1&attribute=title&cursor=not-a-cursor`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'cursor is invalid.' })
    expect(prismaMock.fieldHistory.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/:orgId/field-history — newest-first cursor paging', () => {
  it('returns a keyed newest-first page and an opaque cursor', async () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      historyRow({
        id: `history-${String(51 - index).padStart(2, '0')}`,
        changedAt: new Date(CHANGED_AT.getTime() - index * 1000),
      }),
    )
    prismaMock.fieldHistory.findMany.mockResolvedValue(rows)

    const res = await request(app).get(`${URL_A}?recordId=person-1&attribute=title`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.history).toHaveLength(50)
    expect(res.body.history[0]).toEqual({
      id: 'history-51', recordId: 'person-1', attribute: 'title', oldValue: 'SDR', newValue: 'AE',
      changedByUserId: 'user-a', actor: { name: 'Al Pha', avatarUrl: null }, changeSource: 'user', reason: null,
      changedAt: rows[0].changedAt.toISOString(),
    })
    expect(res.body.nextCursor).toEqual(expect.any(String))
    expect(prismaMock.fieldHistory.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, recordId: 'person-1', attribute: 'title' },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-a'] }, memberships: { some: { orgId: ORG_A } } },
      select: { id: true, email: true, firstName: true, lastName: true, imageUrl: true },
    })
  })

  it('continues after the returned changedAt/id pair without repeating tied rows', async () => {
    const tiedAt = new Date('2026-08-21T09:30:00.000Z')
    const rowsBeforeBoundary = Array.from({ length: 49 }, (_, index) =>
      historyRow({ id: `history-z-${String(index).padStart(2, '0')}`, changedAt: tiedAt }),
    )
    prismaMock.fieldHistory.findMany
      .mockResolvedValueOnce([
        ...rowsBeforeBoundary,
        historyRow({ id: 'history-b', changedAt: tiedAt }),
        historyRow({ id: 'history-a', changedAt: tiedAt }),
      ])
      .mockResolvedValueOnce([historyRow({ id: 'history-a', changedAt: tiedAt })])

    const first = await request(app).get(`${URL_A}?recordId=person-1&attribute=title`).set('Authorization', AUTH)

    const second = await request(app)
      .get(`${URL_A}?recordId=person-1&attribute=title&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Authorization', AUTH)

    expect(first.status).toBe(200)
    expect(first.body.nextCursor).toEqual(expect.any(String))
    expect(second.status).toBe(200)
    expect(prismaMock.fieldHistory.findMany.mock.calls[1][0]).toEqual({
      where: {
        orgId: ORG_A,
        recordId: 'person-1',
        attribute: 'title',
        AND: [{ OR: [{ changedAt: { lt: tiedAt } }, { changedAt: tiedAt, id: { lt: 'history-b' } }] }],
      },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
    expect(second.body.history.map((entry: { id: string }) => entry.id)).toEqual(['history-a'])
    expect(second.body.nextCursor).toBeNull()
  })
})
