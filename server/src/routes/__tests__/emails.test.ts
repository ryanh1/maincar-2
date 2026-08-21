// Route tests for /api/orgs/:orgId/emails (MAI-137, T9).
//
// The unit suite mocks Prisma, so it proves the route WIRING: the org comes from
// the path and reaches every where clause (including the nested participant one),
// the filters and the allowlisted sort do what they say, a message in another org
// is a 404, and no token or mailbox address is ever in a response. Real row state
// and the real unique constraint are proven by emails.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    email: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
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

const NOW = new Date('2026-08-21T12:00:00.000Z')
const SENT = new Date('2026-08-20T09:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/emails`

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

function participantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ep-1', orgId: ORG_A, emailId: 'em-1', role: 'to', name: null,
    address: 'stranger@elsewhere.test', personId: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

function emailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'em-1', orgId: ORG_A, companyId: null, dealId: null, mailAccountId: 'mba-1',
    direction: 'outbound', subject: 'Following up', bodyHtml: '<p>Hi</p>', bodyText: 'Hi',
    snippet: 'Hi', internetMessageId: '<abc@mail.example.com>', conversationId: 'thread-1',
    inReplyTo: null, references: [], importance: 'normal', isRead: false, isDraft: false,
    hasAttachments: false, provider: 'gmail', providerMessageId: 'gmail-1',
    providerThreadId: 'gthread-1', folderOrLabels: ['SENT'], webLink: 'https://mail.google.com/x',
    syncCursor: 'history-99', sentAt: SENT, receivedAt: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.email.count.mockResolvedValue(1)
  prismaMock.email.findMany.mockResolvedValue([
    { ...emailRow(), participants: [participantRow()] },
  ])
  prismaMock.email.findFirst.mockResolvedValue({
    ...emailRow(),
    participants: [participantRow()],
    attachments: [],
  })
})

// --- The tenant boundary ------------------------------------------------------

describe('GET /api/orgs/:orgId/emails — membership', () => {
  it('401s without a token', async () => {
    const res = await request(app).get(URL_A)
    expect(res.status).toBe(401)
    expect(prismaMock.email.findMany).not.toHaveBeenCalled()
  })

  it('404s a non-member — never 403, which would confirm the org exists', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/emails`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
    expect(prismaMock.email.findMany).not.toHaveBeenCalled()
  })

  it('checks membership BEFORE reading any row', async () => {
    authAs(null)
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.email.count).not.toHaveBeenCalled()
  })
})

// --- The list -----------------------------------------------------------------

describe('GET /api/orgs/:orgId/emails', () => {
  it('scopes the read to the org in the PATH', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.email.findMany.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
    expect(prismaMock.email.count.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
  })

  it('counts and pages against the SAME where clause', async () => {
    await request(app).get(`${URL_A}?companyId=co-1&direction=inbound`).set('Authorization', AUTH)
    expect(prismaMock.email.count.mock.calls[0][0].where).toEqual(
      prismaMock.email.findMany.mock.calls[0][0].where,
    )
  })

  it('returns a keyed page envelope', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 25 })
    expect(res.body.emails).toHaveLength(1)
    expect(res.body.emails[0].id).toBe('em-1')
  })

  it('defaults to newest-sent-first with dateless rows LAST', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].orderBy).toEqual([
      { sentAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ])
  })

  it('drops the redundant tie-break when the sort already IS createdAt', async () => {
    await request(app).get(`${URL_A}?sort=createdAt&dir=asc`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }])
  })

  it('refuses a sort column outside the allowlist', async () => {
    const res = await request(app).get(`${URL_A}?sort=bodyHtml`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.email.findMany).not.toHaveBeenCalled()
  })

  it('caps limit at 100 rather than letting one caller ask for the table', async () => {
    const res = await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('100')
  })

  it('paginates with skip and take', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 })
  })

  it('filters by company, deal, mailbox, thread, and direction', async () => {
    await request(app)
      .get(`${URL_A}?companyId=co-1&dealId=de-1&mailAccountId=mba-1&conversationId=t-9&direction=inbound`)
      .set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].where).toMatchObject({
      orgId: ORG_A,
      companyId: 'co-1',
      dealId: 'de-1',
      mailAccountId: 'mba-1',
      conversationId: 't-9',
      direction: 'inbound',
    })
  })

  it('refuses a direction outside the union', async () => {
    const res = await request(app).get(`${URL_A}?direction=sideways`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
  })

  it('carries orgId INSIDE the nested participant filter too', async () => {
    // A related-row condition is its own query. A `some` without orgId would let
    // another tenant's participant rows decide which of this org's emails match.
    await request(app).get(`${URL_A}?personId=per-1`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].where.AND).toEqual([
      { participants: { some: { orgId: ORG_A, personId: 'per-1' } } },
    ])
  })

  it('filters by a raw participant address, case-insensitively (the stranger case)', async () => {
    await request(app).get(`${URL_A}?address=Stranger%40Elsewhere.test`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].where.AND).toEqual([
      {
        participants: {
          some: { orgId: ORG_A, address: { equals: 'stranger@elsewhere.test', mode: 'insensitive' } },
        },
      },
    ])
  })

  it('ANDs a personId and an address filter rather than losing one', async () => {
    await request(app).get(`${URL_A}?personId=per-1&address=x@y.test`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].where.AND).toHaveLength(2)
  })

  it('searches the subject and snippet, never the bodies', async () => {
    await request(app).get(`${URL_A}?q=proposal`).set('Authorization', AUTH)
    const where = prismaMock.email.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { subject: { contains: 'proposal', mode: 'insensitive' } },
      { snippet: { contains: 'proposal', mode: 'insensitive' } },
    ])
  })

  it('treats a blank q as no filter at all', async () => {
    await request(app).get(`${URL_A}?q=%20%20`).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].where).not.toHaveProperty('OR')
  })

  it('loads participants with the page so an inbox row can say who it went to', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.email.findMany.mock.calls[0][0].include).toMatchObject({
      participants: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
    })
    expect(res.body.emails[0].participants[0].address).toBe('stranger@elsewhere.test')
    expect(res.body.emails[0].participants[0].personId).toBeNull()
  })

  it('never sends a message body in a list row', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.emails[0]).not.toHaveProperty('bodyHtml')
    expect(res.body.emails[0]).not.toHaveProperty('bodyText')
  })
})

// --- The detail ---------------------------------------------------------------

describe('GET /api/orgs/:orgId/emails/:id', () => {
  it('looks the row up by id AND orgId together', async () => {
    const res = await request(app).get(`${URL_A}/em-1`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.email.findFirst.mock.calls[0][0].where).toEqual({ id: 'em-1', orgId: ORG_A })
  })

  it("404s a real id that belongs to another org, the same as one that doesn't exist", async () => {
    prismaMock.email.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/em-other`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Email not found' })
  })

  it('returns the bodies, participants, and attachments under a keyed envelope', async () => {
    prismaMock.email.findFirst.mockResolvedValue({
      ...emailRow(),
      hasAttachments: true,
      participants: [participantRow({ role: 'from', address: 'rep@ourco.test' }), participantRow()],
      attachments: [
        {
          id: 'ea-1', orgId: ORG_A, emailId: 'em-1', filename: 'proposal.pdf',
          contentType: 'application/pdf', sizeBytes: 4096, isInline: false, contentId: null,
          storageUrl: null, providerAttachmentId: 'att-1', createdAt: NOW, updatedAt: NOW,
        },
      ],
    })
    const res = await request(app).get(`${URL_A}/em-1`).set('Authorization', AUTH)
    expect(res.body.email.bodyHtml).toBe('<p>Hi</p>')
    expect(res.body.email.participants).toHaveLength(2)
    expect(res.body.email.attachments[0]).toMatchObject({
      filename: 'proposal.pdf',
      isStored: false,
    })
  })

  it('never returns orgId, a storage key, or any sync bookkeeping', async () => {
    const res = await request(app).get(`${URL_A}/em-1`).set('Authorization', AUTH)
    expect(res.body.email).not.toHaveProperty('orgId')
    expect(res.body.email).not.toHaveProperty('syncCursor')
    expect(res.body.email).not.toHaveProperty('providerMessageId')
  })

  it('never returns a token, a scope, or a mailbox address — only a mailAccountId', async () => {
    const res = await request(app).get(`${URL_A}/em-1`).set('Authorization', AUTH)
    const body = JSON.stringify(res.body)
    expect(res.body.email.mailAccountId).toBe('mba-1')
    expect(body).not.toContain('refreshToken')
    expect(body).not.toContain('accessToken')
    expect(body).not.toContain('scopes')
  })
})

// --- Read only ----------------------------------------------------------------

describe('the router is read-only', () => {
  // Composing and mailbox sync are a later spec. A live-looking write route that
  // half-works is worse than none (CLAUDE.md → Verification before finishing), so
  // the absence of one is asserted rather than assumed.
  it('does not route a POST', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })

  it('does not route a PATCH', async () => {
    const res = await request(app).patch(`${URL_A}/em-1`).set('Authorization', AUTH).send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })

  it('does not route a DELETE', async () => {
    const res = await request(app).delete(`${URL_A}/em-1`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })
})
