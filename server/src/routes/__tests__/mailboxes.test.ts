// Route tests for the mailbox routes:
//   GET    /api/mailboxes/orgs/:orgId
//   PATCH  /api/mailboxes/orgs/:orgId/:mailboxId
//   POST   /api/mailboxes/orgs/:orgId/:mailboxId/primary
//   DELETE /api/mailboxes/orgs/:orgId/:mailboxId
//
// These prove the ROUTE contract: membership is re-proven from the path (a non-member
// is 404, never a 403 that would confirm the org); the list carries each mailbox's
// parent-connection status in a token-free shape; a promote returns the WHOLE set with
// exactly one primary; a foreign or stale id is 404, never a leak; a too-long display
// name is rejected with its own named message; and no response body ever carries a
// token. The ATOMIC flag move and its concurrency guarantee live in mailAccounts.ts
// and are proven against real Postgres (mailAccounts.integration.test.ts,
// mailboxes.integration.test.ts) — here setPrimaryMailbox/disconnectConnection are
// stubbed so the unit suite never touches the database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, setPrimaryMailboxMock, disconnectConnectionMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    mailAccount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever writes a mailbox by bare id.
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  verifyTokenMock: vi.fn(),
  // The atomic clear-and-set and the grant-delete-and-promote are stubbed: this suite tests
  // the route (auth, scoping, 404 mapping, response), not the transaction, which is
  // proven against real Postgres.
  setPrimaryMailboxMock: vi.fn(),
  disconnectConnectionMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../lib/mail/mailAccounts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/mail/mailAccounts.js')>()
  return { ...actual, setPrimaryMailbox: setPrimaryMailboxMock }
})
vi.mock('../../lib/mail/oauthConnections.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/mail/oauthConnections.js')>()
  return { ...actual, disconnectConnection: disconnectConnectionMock }
})

import { DISPLAY_NAME_TOO_LONG } from '../mailboxes.js'

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const URL_A = `/api/mailboxes/orgs/${ORG_A}`
const SECRET = 'SECRET-REFRESH-TOKEN'

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@orga.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: 'America/New_York',
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: ORG_A,
    roles: ['basic'],
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

// A mailbox row as the public select returns it — including its parent connection's
// status. A stray token field is added so a test can prove serialize drops it.
function boxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'box-1',
    provider: 'google',
    emailAddress: 'rep@acme.com',
    displayName: null,
    isPrimary: true,
    connectionId: 'conn-1',
    createdAt: NOW,
    connection: {
      status: 'connected',
      statusDetail: null,
      errorCode: null,
      lastValidatedAt: NOW,
    },
    // Not in the select in production; here to prove serializeMailbox never leaks it.
    refreshToken: SECRET,
    ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.mailAccount.findMany.mockResolvedValue([])
  prismaMock.mailAccount.findFirst.mockResolvedValue(null)
  prismaMock.mailAccount.updateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// GET — the list
// ============================================================
describe('GET /api/mailboxes/orgs/:orgId', () => {
  it('lists this rep’s mailboxes, scoped to (orgId, userId), in the token-free public shape', async () => {
    prismaMock.mailAccount.findMany.mockResolvedValue([boxRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.mailAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG_A, userId: 'user-a' },
        orderBy: { createdAt: 'asc' },
      }),
    )
    expect(res.body.mailboxes).toHaveLength(1)
    const box = res.body.mailboxes[0]
    expect(box).toMatchObject({
      id: 'box-1',
      provider: 'google',
      providerLabel: 'Google',
      emailAddress: 'rep@acme.com',
      displayName: null,
      isPrimary: true,
      status: 'connected', // mirrors the parent connection
      statusDetail: '',
      errorCode: null,
      lastValidatedAt: NOW.toISOString(),
      connectionId: 'conn-1',
    })
    expect(box.connectedAt).toBe(NOW.toISOString())
  })

  it('mirrors a troubled connection’s status onto the mailbox row', async () => {
    prismaMock.mailAccount.findMany.mockResolvedValue([
      boxRow({ connection: { status: 'error', statusDetail: 'Access was revoked; reconnect the mailbox.' } }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.mailboxes[0].status).toBe('error')
    expect(res.body.mailboxes[0].statusDetail).toBe('Access was revoked; reconnect the mailbox.')
  })

  it('returns an empty list, not a 404, when the rep has no mailbox', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ mailboxes: [] })
  })

  it('answers 404 for a non-member, before reading any mailbox', async () => {
    authAs(null)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.mailAccount.findMany).not.toHaveBeenCalled()
  })

  it('never returns a token in the body', async () => {
    prismaMock.mailAccount.findMany.mockResolvedValue([boxRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(JSON.stringify(res.body)).not.toContain(SECRET)
    expect(res.body.mailboxes[0]).not.toHaveProperty('refreshToken')
  })
})

// ============================================================
// PATCH — rename
// ============================================================
describe('PATCH /api/mailboxes/orgs/:orgId/:mailboxId', () => {
  it('sets the display name through a scoped updateMany and returns the mailbox', async () => {
    prismaMock.mailAccount.findFirst.mockResolvedValue(boxRow({ displayName: 'Work inbox' }))

    const res = await request(app)
      .patch(`${URL_A}/box-1`)
      .set('Authorization', AUTH)
      .send({ displayName: 'Work inbox' })

    expect(res.status).toBe(200)
    expect(prismaMock.mailAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'box-1', orgId: ORG_A, userId: 'user-a' },
      data: { displayName: 'Work inbox' },
    })
    expect(res.body.mailbox.displayName).toBe('Work inbox')
    // Never a bare-id write.
    expect(prismaMock.mailAccount.update).not.toHaveBeenCalled()
  })

  it('clears the name when given an empty or whitespace value', async () => {
    prismaMock.mailAccount.findFirst.mockResolvedValue(boxRow({ displayName: null }))

    await request(app).patch(`${URL_A}/box-1`).set('Authorization', AUTH).send({ displayName: '   ' })

    expect(prismaMock.mailAccount.updateMany.mock.calls[0][0].data).toEqual({ displayName: null })
  })

  it('rejects a too-long display name with its own named message', async () => {
    const res = await request(app)
      .patch(`${URL_A}/box-1`)
      .set('Authorization', AUTH)
      .send({ displayName: 'x'.repeat(200) })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: DISPLAY_NAME_TOO_LONG })
    expect(prismaMock.mailAccount.updateMany).not.toHaveBeenCalled()
  })

  it('404s a mailbox id that is not this rep’s — the scoped updateMany matches zero rows', async () => {
    prismaMock.mailAccount.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .patch(`${URL_A}/box-foreign`)
      .set('Authorization', AUTH)
      .send({ displayName: 'Mine now' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Mailbox not found' })
  })
})

// ============================================================
// POST — promote to primary
// ============================================================
describe('POST /api/mailboxes/orgs/:orgId/:mailboxId/primary', () => {
  it('promotes the mailbox and returns the WHOLE list with exactly one primary', async () => {
    setPrimaryMailboxMock.mockResolvedValue([{ id: 'box-1' }, { id: 'box-2' }]) // truthy = moved
    prismaMock.mailAccount.findMany.mockResolvedValue([
      boxRow({ id: 'box-1', isPrimary: false }),
      boxRow({ id: 'box-2', isPrimary: true, emailAddress: 'work@acme.com' }),
    ])

    const res = await request(app).post(`${URL_A}/box-2/primary`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(setPrimaryMailboxMock).toHaveBeenCalledWith('box-2', ORG_A, 'user-a')
    expect(res.body.mailboxes).toHaveLength(2)
    expect(res.body.mailboxes.filter((b: { isPrimary: boolean }) => b.isPrimary)).toHaveLength(1)
    expect(res.body.mailboxes.find((b: { isPrimary: boolean }) => b.isPrimary).id).toBe('box-2')
  })

  it('404s a mailbox id that is not this rep’s — setPrimaryMailbox returns null', async () => {
    setPrimaryMailboxMock.mockResolvedValue(null)

    const res = await request(app).post(`${URL_A}/box-foreign/primary`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Mailbox not found' })
  })

  it('answers 404 for a non-member without moving any flag', async () => {
    authAs(null)

    const res = await request(app).post(`${URL_A}/box-2/primary`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(setPrimaryMailboxMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE — disconnect
// ============================================================
describe('DELETE /api/mailboxes/orgs/:orgId/:mailboxId', () => {
  it('deletes the mailbox grant and returns the remaining list', async () => {
    prismaMock.mailAccount.findFirst.mockResolvedValue(boxRow())
    disconnectConnectionMock.mockResolvedValue({ provider: 'google' })
    prismaMock.mailAccount.findMany.mockResolvedValue([boxRow({ id: 'box-2', isPrimary: true })])

    const res = await request(app).delete(`${URL_A}/box-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(disconnectConnectionMock).toHaveBeenCalledWith('conn-1', ORG_A, 'user-a')
    expect(res.body.mailboxes).toHaveLength(1)
    // Never a bare-id delete.
    expect(prismaMock.mailAccount.delete).not.toHaveBeenCalled()
  })

  it('404s a mailbox id that is not this rep’s before deleting a grant', async () => {
    const res = await request(app).delete(`${URL_A}/box-foreign`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Mailbox not found' })
    expect(disconnectConnectionMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a non-member without deleting anything', async () => {
    authAs(null)

    const res = await request(app).delete(`${URL_A}/box-1`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(disconnectConnectionMock).not.toHaveBeenCalled()
  })
})
