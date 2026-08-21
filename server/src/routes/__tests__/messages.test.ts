// Route tests for /api/orgs/:orgId/messages (MAI-138, T10).
//
// The unit suite mocks Prisma, so it proves the route WIRING: the org comes from
// the path and reaches every where clause, the filters and the allowlisted sort do
// what they say, a message in another org is a 404, and nothing the client has no
// business with (orgId, a storage key, the price) is in a response. Real row state
// and the real unique constraint are proven by messages.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    smsMessage: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
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
const URL_A = `/api/orgs/${ORG_A}/messages`

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

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mm-1', orgId: ORG_A, smsMessageId: 'sms-1', contentType: 'image/jpeg',
    storageUrl: null, twilioMediaSid: 'ME1', sizeBytes: 91_204, sortOrder: 0,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function smsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sms-1', orgId: ORG_A, personId: null, companyId: null, dealId: null,
    mailboxUserId: 'user-a', phoneNumberId: 'pn-1',
    fromE164: '+12025550199', toE164: '+12025550123', direction: 'inbound',
    body: 'Hi, saw your listing', status: 'received', errorCode: null, errorMessage: null,
    numSegments: 1, numMedia: 0, channel: 'sms', twilioSid: 'SM1', messagingServiceSid: null,
    price: '-0.0075', priceUnit: 'USD', sentAt: SENT, deliveredAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
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
  prismaMock.smsMessage.count.mockResolvedValue(1)
  prismaMock.smsMessage.findMany.mockResolvedValue([smsRow()])
  prismaMock.smsMessage.findFirst.mockResolvedValue({ ...smsRow(), media: [] })
})

// --- The tenant boundary ------------------------------------------------------

describe('GET /api/orgs/:orgId/messages — membership', () => {
  it('401s without a token', async () => {
    const res = await request(app).get(URL_A)
    expect(res.status).toBe(401)
    expect(prismaMock.smsMessage.findMany).not.toHaveBeenCalled()
  })

  it('404s a non-member — never 403, which would confirm the org exists', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/messages`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
    expect(prismaMock.smsMessage.findMany).not.toHaveBeenCalled()
  })

  it('checks membership BEFORE reading any row', async () => {
    authAs(null)
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.count).not.toHaveBeenCalled()
  })
})

// --- The list -----------------------------------------------------------------

describe('GET /api/orgs/:orgId/messages', () => {
  it('scopes the read to the org in the PATH', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
    expect(prismaMock.smsMessage.count.mock.calls[0][0].where).toMatchObject({ orgId: ORG_A })
  })

  it('counts and pages against the SAME where clause', async () => {
    await request(app).get(`${URL_A}?personId=per-1&direction=inbound`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.count.mock.calls[0][0].where).toEqual(
      prismaMock.smsMessage.findMany.mock.calls[0][0].where,
    )
  })

  it('returns a keyed page envelope', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 25 })
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.messages[0].id).toBe('sms-1')
  })

  it('defaults to newest-sent-first with dateless rows LAST', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].orderBy).toEqual([
      { sentAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ])
  })

  it('drops the redundant tie-break when the sort already IS createdAt', async () => {
    await request(app).get(`${URL_A}?sort=createdAt&dir=asc`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }])
  })

  it('refuses a sort column outside the allowlist', async () => {
    const res = await request(app).get(`${URL_A}?sort=body`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(prismaMock.smsMessage.findMany).not.toHaveBeenCalled()
  })

  it('caps limit at 100 rather than letting one caller ask for the table', async () => {
    const res = await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('100')
  })

  it('paginates with skip and take', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 })
  })

  it('filters by person, company, deal, rep, and our number', async () => {
    await request(app)
      .get(`${URL_A}?personId=per-1&companyId=co-1&dealId=de-1&mailboxUserId=user-a&phoneNumberId=pn-1`)
      .set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where).toMatchObject({
      orgId: ORG_A,
      personId: 'per-1',
      companyId: 'co-1',
      dealId: 'de-1',
      mailboxUserId: 'user-a',
      phoneNumberId: 'pn-1',
    })
  })

  it('filters by the RAW numbers — the only handle a stranger has', async () => {
    // A text from a number nobody has ever heard of has no personId to filter on.
    await request(app)
      .get(`${URL_A}?fromE164=%2B12025550199&toE164=%2B12025550123`)
      .set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where).toMatchObject({
      fromE164: '+12025550199',
      toE164: '+12025550123',
    })
  })

  it('filters by direction, status, and channel', async () => {
    await request(app)
      .get(`${URL_A}?direction=outbound&status=undelivered&channel=mms`)
      .set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where).toMatchObject({
      direction: 'outbound',
      status: 'undelivered',
      channel: 'mms',
    })
  })

  it('refuses a direction, status, or channel outside the union', async () => {
    for (const bad of ['direction=sideways', 'status=maybe', 'channel=pigeon']) {
      const res = await request(app).get(`${URL_A}?${bad}`).set('Authorization', AUTH)
      expect(res.status).toBe(400)
    }
    expect(prismaMock.smsMessage.findMany).not.toHaveBeenCalled()
  })

  it('searches the message body', async () => {
    await request(app).get(`${URL_A}?q=listing`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where.body).toEqual({
      contains: 'listing',
      mode: 'insensitive',
    })
  })

  it('treats a blank q as no filter at all', async () => {
    await request(app).get(`${URL_A}?q=%20%20`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0].where).not.toHaveProperty('body')
  })

  it('does NOT join the media table for a list page', async () => {
    // A list row only needs to know media exist, and numMedia is the column Twilio
    // already gave us for that. Joining per row is the N+1 this avoids.
    await request(app).get(URL_A).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findMany.mock.calls[0][0]).not.toHaveProperty('include')
  })

  it('returns a stranger row readable from its raw numbers alone', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.messages[0]).toMatchObject({
      personId: null,
      companyId: null,
      dealId: null,
      fromE164: '+12025550199',
      body: 'Hi, saw your listing',
    })
  })

  it('never returns orgId or the price in a list row', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.body.messages[0]).not.toHaveProperty('orgId')
    expect(res.body.messages[0]).not.toHaveProperty('price')
  })
})

// --- The detail ---------------------------------------------------------------

describe('GET /api/orgs/:orgId/messages/:id', () => {
  it('looks the row up by id AND orgId together', async () => {
    const res = await request(app).get(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.smsMessage.findFirst.mock.calls[0][0].where).toEqual({
      id: 'sms-1',
      orgId: ORG_A,
    })
  })

  it("404s a real id that belongs to another org, the same as one that doesn't exist", async () => {
    prismaMock.smsMessage.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/sms-other`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Message not found' })
  })

  it('loads the media in the order Twilio numbered them on the webhook', async () => {
    await request(app).get(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(prismaMock.smsMessage.findFirst.mock.calls[0][0].include).toEqual({
      media: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    })
  })

  it('returns an MMS with two images as two media entries under a keyed envelope', async () => {
    prismaMock.smsMessage.findFirst.mockResolvedValue({
      ...smsRow({ channel: 'mms', numMedia: 2 }),
      media: [
        mediaRow({ id: 'mm-1', sortOrder: 0, contentType: 'image/jpeg' }),
        mediaRow({ id: 'mm-2', sortOrder: 1, contentType: 'image/png' }),
      ],
    })
    const res = await request(app).get(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(res.body.message.channel).toBe('mms')
    expect(res.body.message.media).toHaveLength(2)
    expect(res.body.message.media.map((m: { contentType: string }) => m.contentType)).toEqual([
      'image/jpeg',
      'image/png',
    ])
  })

  it('returns the delivery failure detail on a message that did not land', async () => {
    prismaMock.smsMessage.findFirst.mockResolvedValue({
      ...smsRow({
        direction: 'outbound',
        status: 'undelivered',
        errorCode: '30003',
        errorMessage: 'Unreachable destination handset',
      }),
      media: [],
    })
    const res = await request(app).get(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(res.body.message).toMatchObject({
      status: 'undelivered',
      errorCode: '30003',
      errorMessage: 'Unreachable destination handset',
      deliveredAt: null,
    })
  })

  it('never returns orgId, a media storage key, or what it cost', async () => {
    prismaMock.smsMessage.findFirst.mockResolvedValue({
      ...smsRow({ channel: 'mms', numMedia: 1 }),
      media: [mediaRow({ storageUrl: 'maincar-mms/org-a/mm-1.jpg' })],
    })
    const res = await request(app).get(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(res.body.message).not.toHaveProperty('orgId')
    expect(res.body.message).not.toHaveProperty('price')
    expect(res.body.message.media[0]).not.toHaveProperty('storageUrl')
    expect(res.body.message.media[0].isStored).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('maincar-mms')
  })
})

// --- Read only ----------------------------------------------------------------

describe('the router is read-only', () => {
  // Sending, and the Twilio inbound/status webhooks, are a later spec. A
  // live-looking write route that half-works is worse than none (CLAUDE.md →
  // Verification before finishing), so the absence of one is asserted rather than
  // assumed.
  it('does not route a POST', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })

  it('does not route a PATCH', async () => {
    const res = await request(app).patch(`${URL_A}/sms-1`).set('Authorization', AUTH).send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })

  it('does not route a DELETE', async () => {
    const res = await request(app).delete(`${URL_A}/sms-1`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })
})
