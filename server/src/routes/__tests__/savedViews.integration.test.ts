// Real-Postgres coverage for saved views. The unit suite proves route wiring;
// these tests prove persistence, audience boundaries, and the transaction that
// keeps one default per object/audience under concurrent requests.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')
  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return { default: new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const as = (firebaseUid: string): string => `Bearer ${firebaseUid}`

async function seedViewContext() {
  const org = await seedOrgWithAdmin(prisma, { seed: true })
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
  const object = await prisma.objectDef.findFirstOrThrow({ where: { orgId: org.orgId, slug: 'person' } })
  const attribute = await prisma.attributeDef.findFirstOrThrow({ where: { orgId: org.orgId, objectId: object.id } })
  return { org, admin, object, attribute }
}

async function createView(orgId: string, firebaseUid: string, objectId: string, name: string) {
  return request(app)
    .post(`/api/orgs/${orgId}/saved-views`)
    .set('Authorization', as(firebaseUid))
    .send({ objectId, name, layout: 'grid', config: { columns: [] } })
}

describe('SavedView (integration, real Postgres, real routes)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('keeps exactly one shared default after concurrent default selections', async () => {
    const { org, admin, object } = await seedViewContext()
    const first = await createView(org.orgId, admin.firebaseUid, object.id, 'First')
    const second = await createView(org.orgId, admin.firebaseUid, object.id, 'Second')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    // Both personal views are the same audience. The ObjectDef row lock in the
    // service serializes these selections instead of relying on timing.
    const results = await Promise.all([
      request(app).post(`/api/orgs/${org.orgId}/saved-views/${first.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)),
      request(app).post(`/api/orgs/${org.orgId}/saved-views/${second.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)),
    ])
    expect(results.map((result) => result.status)).toEqual([204, 204])

    const defaults = await prisma.savedView.findMany({
      where: { orgId: org.orgId, objectId: object.id, isShared: false, isDefault: true, deletedAt: null },
    })
    expect(defaults).toHaveLength(1)
    expect([first.body.view.id, second.body.view.id]).toContain(defaults[0].id)
  })

  it('keeps personal defaults independent for different members of the same object', async () => {
    const { org, admin, object } = await seedViewContext()
    const teammate = await prisma.user.create({
      data: { firebaseUid: `saved-view-${randomUUID()}`, email: `saved-view-${randomUUID()}@example.test` },
    })
    await prisma.membership.create({ data: { orgId: org.orgId, userId: teammate.id, roles: ['basic'] } })
    const mine = await createView(org.orgId, admin.firebaseUid, object.id, 'My default')
    const theirs = await createView(org.orgId, teammate.firebaseUid, object.id, 'Their default')

    await request(app).post(`/api/orgs/${org.orgId}/saved-views/${mine.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)).expect(204)
    await request(app).post(`/api/orgs/${org.orgId}/saved-views/${theirs.body.view.id}/default`).set('Authorization', as(teammate.firebaseUid)).expect(204)

    const defaults = await prisma.savedView.findMany({
      where: { orgId: org.orgId, objectId: object.id, isShared: false, isDefault: true, deletedAt: null },
      orderBy: { ownerUserId: 'asc' },
    })
    expect(defaults.map((view) => [view.ownerUserId, view.id])).toEqual(expect.arrayContaining([
      [admin.id, mine.body.view.id],
      [teammate.id, theirs.body.view.id],
    ]))
  })

  it('keeps personal views private, then grants shared discovery and member edits without changing CRM data', async () => {
    const { org, admin, object } = await seedViewContext()
    const teammate = await prisma.user.create({
      data: { firebaseUid: `saved-view-${randomUUID()}`, email: `saved-view-${randomUUID()}@example.test` },
    })
    await prisma.membership.create({ data: { orgId: org.orgId, userId: teammate.id, roles: ['basic'] } })
    const created = await createView(org.orgId, admin.firebaseUid, object.id, 'My prospects')
    expect(created.status).toBe(201)

    const privateRead = await request(app)
      .get(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(teammate.firebaseUid))
    expect(privateRead.status).toBe(404)

    const shared = await request(app)
      .patch(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ isShared: true })
    expect(shared.status).toBe(200)
    expect(shared.body.view.isShared).toBe(true)

    const teammateEdit = await request(app)
      .patch(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(teammate.firebaseUid))
      .send({ name: 'Team prospects' })
    expect(teammateEdit.status).toBe(200)

    const stored = await prisma.savedView.findFirstOrThrow({ where: { id: created.body.view.id, orgId: org.orgId } })
    expect(stored.name).toBe('Team prospects')
    expect(stored.objectId).toBe(object.id)
  })

  it('persists and reloads a Team scope unchanged with a saved grid view', async () => {
    const { org, admin, object } = await seedViewContext()
    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views`)
      .set('Authorization', as(admin.firebaseUid))
      .send({
        objectId: object.id,
        name: 'Revenue team',
        layout: 'grid',
        config: { teamScope: { teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] } },
      })
    expect(created.status).toBe(201)

    const reloaded = await request(app)
      .get(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(reloaded.status).toBe(200)
    expect(reloaded.body.view.config.teamScope).toEqual({ teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] })
  })

  it('keeps a URL overlay session-only, resets it without a write, and duplicates as a personal non-default view', async () => {
    const { org, admin, object, attribute } = await seedViewContext()
    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ objectId: object.id, name: 'Tall people', layout: 'grid', config: { rowHeight: 'tall' } })
    expect(created.status).toBe(201)

    const encoded = Buffer.from(JSON.stringify({
      version: 1,
      sorts: [{ attributeId: attribute.id, direction: 'desc' }],
    })).toString('base64url')
    const resolved = await request(app)
      .get(`/api/orgs/${org.orgId}/saved-views/resolve?objectId=${object.id}&viewId=${created.body.view.id}&v=${encoded}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(resolved.status).toBe(200)
    expect(resolved.body.hasUnsavedChanges).toBe(true)
    expect(resolved.body.config.rowHeight).toBe('tall')
    expect(resolved.body.config.sorts).toEqual([{ attributeId: attribute.id, direction: 'desc' }])

    const reset = await request(app)
      .get(`/api/orgs/${org.orgId}/saved-views/resolve?objectId=${object.id}&viewId=${created.body.view.id}&v=${encoded}&reset=true`)
      .set('Authorization', as(admin.firebaseUid))
    expect(reset.status).toBe(200)
    expect(reset.body.hasUnsavedChanges).toBe(false)
    expect(reset.body.config.rowHeight).toBe('tall')
    expect(reset.body.config.sorts).toEqual([])

    const duplicate = await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}/duplicate`)
      .set('Authorization', as(admin.firebaseUid))
    expect(duplicate.status).toBe(201)
    expect(duplicate.body.view).toMatchObject({ name: 'Tall people copy', isShared: false, isDefault: false })
    expect(duplicate.body.view.config.rowHeight).toBe('tall')
  })

  it('refuses to delete an active default and soft-deletes only its configuration after another default is chosen', async () => {
    const { org, admin, object } = await seedViewContext()
    const first = await createView(org.orgId, admin.firebaseUid, object.id, 'Keep')
    const second = await createView(org.orgId, admin.firebaseUid, object.id, 'Replacement')
    await request(app).post(`/api/orgs/${org.orgId}/saved-views/${first.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)).expect(204)

    const blocked = await request(app)
      .delete(`/api/orgs/${org.orgId}/saved-views/${first.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(blocked.status).toBe(409)

    await request(app).post(`/api/orgs/${org.orgId}/saved-views/${second.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)).expect(204)
    await request(app).delete(`/api/orgs/${org.orgId}/saved-views/${first.body.view.id}`).set('Authorization', as(admin.firebaseUid)).expect(204)

    const deleted = await prisma.savedView.findFirstOrThrow({ where: { id: first.body.view.id, orgId: org.orgId } })
    expect(deleted.deletedAt).toBeInstanceOf(Date)
    expect(deleted.isDefault).toBe(false)
  })

  it('requires a replacement default before changing a default view’s visibility', async () => {
    const { org, admin, object } = await seedViewContext()
    const created = await createView(org.orgId, admin.firebaseUid, object.id, 'Default view')
    await request(app).post(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)).expect(204)

    const visibilityChange = await request(app)
      .patch(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ isShared: true })
    expect(visibilityChange.status).toBe(409)

    const stored = await prisma.savedView.findFirstOrThrow({ where: { id: created.body.view.id, orgId: org.orgId } })
    expect(stored).toMatchObject({ isShared: false, isDefault: true })
  })
})
