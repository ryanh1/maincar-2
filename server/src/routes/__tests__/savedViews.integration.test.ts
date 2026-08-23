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

async function createNestedView(orgId: string, firebaseUid: string, objectId: string, name: string) {
  return request(app)
    .post(`/api/orgs/${orgId}/objects/${objectId}/views`)
    .set('Authorization', as(firebaseUid))
    .send({ name, layout: 'grid', configJson: { columns: [] } })
}

describe('SavedView (integration, real Postgres, real routes)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('rejects an unknown configJson attribute through the nested object route', async () => {
    const { org, admin, object } = await seedViewContext()

    const response = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${object.id}/views`)
      .set('Authorization', as(admin.firebaseUid))
      .send({
        name: 'Broken view',
        layout: 'grid',
        configJson: { columns: [{ attributeId: 'unknown-attribute', visible: true, order: 0 }] },
      })

    expect(response.status).toBe(422)
    expect(await prisma.savedView.count({ where: { orgId: org.orgId, objectId: object.id } })).toBe(0)
  })

  it('round-trips fields, ordering, filters, grouping, density, frozen panes, widths, and layout', async () => {
    const { org, admin, object, attribute } = await seedViewContext()
    const configJson = {
      columns: [{ attributeId: attribute.id, visible: true, order: 0 }],
      sorts: [{ attributeId: attribute.id, direction: 'asc' }],
      filterTree: { type: 'condition', attributeId: attribute.id, operator: 'contains', value: 'Ada' },
      groupBy: [{ attributeId: attribute.id, direction: 'desc' }],
      rowHeight: 'comfortable',
      frozenRows: 2,
      frozenCols: 1,
      columnWidths: { [attribute.id]: 320 },
    }
    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${object.id}/views`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'My working view', layout: 'kanban', configJson })
    expect(created.status).toBe(201)

    const reopened = await request(app)
      .get(`/api/orgs/${org.orgId}/objects/${object.id}/views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(reopened.status).toBe(200)
    const { columns, ...configWithoutColumns } = configJson
    expect(reopened.body.view).toMatchObject({ layout: 'kanban', configJson: configWithoutColumns })
    expect(reopened.body.view.configJson.columns).toEqual(expect.arrayContaining(columns))
  })

  it('keeps exactly one nested-route default after concurrent selections', async () => {
    const { org, admin, object } = await seedViewContext()
    const first = await createNestedView(org.orgId, admin.firebaseUid, object.id, 'First')
    const second = await createNestedView(org.orgId, admin.firebaseUid, object.id, 'Second')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const results = await Promise.all([
      request(app).post(`/api/orgs/${org.orgId}/objects/${object.id}/views/${first.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)),
      request(app).post(`/api/orgs/${org.orgId}/objects/${object.id}/views/${second.body.view.id}/default`).set('Authorization', as(admin.firebaseUid)),
    ])
    expect(results.map((result) => result.status)).toEqual([204, 204])

    const defaults = await prisma.savedView.findMany({
      where: { orgId: org.orgId, objectId: object.id, isShared: false, isDefault: true, deletedAt: null },
    })
    expect(defaults).toHaveLength(1)
  })

  it('deletes only the saved configuration and returns an undo token', async () => {
    const { org, admin, object } = await seedViewContext()
    const created = await createNestedView(org.orgId, admin.firebaseUid, object.id, 'Disposable')
    expect(created.status).toBe(201)
    const recordsBefore = await prisma.person.count({ where: { orgId: org.orgId } })

    const deleted = await request(app)
      .delete(`/api/orgs/${org.orgId}/objects/${object.id}/views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))

    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ undoToken: created.body.view.id })
    expect(await prisma.person.count({ where: { orgId: org.orgId } })).toBe(recordsBefore)
    expect(await prisma.savedView.findFirst({ where: { id: created.body.view.id, orgId: org.orgId } })).toMatchObject({ deletedAt: expect.any(Date) })

    await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${object.id}/views/undo`)
      .set('Authorization', as(admin.firebaseUid))
      .send(deleted.body)
      .expect(204)
    expect(await prisma.savedView.findFirst({ where: { id: created.body.view.id, orgId: org.orgId } })).toMatchObject({ deletedAt: null })
  })

  it('updates, duplicates, and reorders nested saved views', async () => {
    const { org, admin, object, attribute } = await seedViewContext()
    const first = await createNestedView(org.orgId, admin.firebaseUid, object.id, 'First')
    const second = await createNestedView(org.orgId, admin.firebaseUid, object.id, 'Second')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const updated = await request(app)
      .patch(`/api/orgs/${org.orgId}/objects/${object.id}/views/${first.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
      .send({
        name: 'Renamed',
        configJson: { sorts: [{ attributeId: attribute.id, direction: 'desc' }] },
      })
    expect(updated.status).toBe(200)
    expect(updated.body.view).toMatchObject({ name: 'Renamed', configJson: { sorts: [{ attributeId: attribute.id, direction: 'desc' }] } })

    const duplicate = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${object.id}/views/${first.body.view.id}/duplicate`)
      .set('Authorization', as(admin.firebaseUid))
    expect(duplicate.status).toBe(201)
    expect(duplicate.body.view).toMatchObject({ name: 'Renamed copy', isShared: false, isDefault: false })

    const reordered = await request(app)
      .put(`/api/orgs/${org.orgId}/objects/${object.id}/views/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ viewIds: [duplicate.body.view.id, second.body.view.id, first.body.view.id] })
    expect(reordered.status).toBe(200)
    expect(reordered.body.views.map((view: { id: string }) => view.id)).toEqual([
      duplicate.body.view.id,
      second.body.view.id,
      first.body.view.id,
    ])
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

  it('returns 404 when a non-member guesses a shared view URL', async () => {
    const { org, admin, object } = await seedViewContext()
    const outsiderOrg = await seedOrgWithAdmin(prisma)
    const outsider = await prisma.user.findUniqueOrThrow({ where: { id: outsiderOrg.adminUserId } })
    const created = await createView(org.orgId, admin.firebaseUid, object.id, 'Shared prospects')
    await request(app)
      .patch(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ isShared: true })
      .expect(200)

    await request(app)
      .get(`/api/orgs/${org.orgId}/saved-views/${created.body.view.id}`)
      .set('Authorization', as(outsider.firebaseUid))
      .expect(404)
  })

  it('persists a complete saved-view switcher order atomically', async () => {
    const { org, admin, object } = await seedViewContext()
    const first = await createView(org.orgId, admin.firebaseUid, object.id, 'First')
    const second = await createView(org.orgId, admin.firebaseUid, object.id, 'Second')
    const third = await createView(org.orgId, admin.firebaseUid, object.id, 'Third')

    const order = [third.body.view.id, first.body.view.id, second.body.view.id]
    await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ objectId: object.id, viewIds: order })
      .expect(204)

    const stored = await prisma.savedView.findMany({
      where: { orgId: org.orgId, objectId: object.id, ownerUserId: admin.id, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    })
    expect(stored.map((view) => view.id)).toEqual(order)
    expect(stored.map((view) => view.sortOrder)).toEqual([0, 1, 2])
  })

  it('rejects an incomplete switcher order without changing stored positions', async () => {
    const { org, admin, object } = await seedViewContext()
    const first = await createView(org.orgId, admin.firebaseUid, object.id, 'First')
    const second = await createView(org.orgId, admin.firebaseUid, object.id, 'Second')

    const rejected = await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ objectId: object.id, viewIds: [second.body.view.id] })
    expect(rejected.status).toBe(422)

    const stored = await prisma.savedView.findMany({
      where: { orgId: org.orgId, objectId: object.id, ownerUserId: admin.id, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    })
    expect(stored.map((view) => [view.id, view.sortOrder])).toEqual([
      [first.body.view.id, 0],
      [second.body.view.id, 0],
    ])
  })

  it('cannot reorder another member’s private view', async () => {
    const { org, admin, object } = await seedViewContext()
    const teammate = await prisma.user.create({
      data: { firebaseUid: `saved-view-${randomUUID()}`, email: `saved-view-${randomUUID()}@example.test` },
    })
    await prisma.membership.create({ data: { orgId: org.orgId, userId: teammate.id, roles: ['basic'] } })
    const mine = await createView(org.orgId, admin.firebaseUid, object.id, 'Mine')
    const theirs = await createView(org.orgId, teammate.firebaseUid, object.id, 'Theirs')

    const rejected = await request(app)
      .post(`/api/orgs/${org.orgId}/saved-views/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ objectId: object.id, viewIds: [theirs.body.view.id, mine.body.view.id] })
    expect(rejected.status).toBe(422)

    const stored = await prisma.savedView.findFirstOrThrow({ where: { id: theirs.body.view.id, orgId: org.orgId } })
    expect(stored.sortOrder).toBe(0)
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
