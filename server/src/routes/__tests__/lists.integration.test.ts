// Integration tests for the list routes against a REAL Postgres schema, driving
// the ACTUAL Express app over supertest (see vitest.integration.config.ts and
// src/test/integration/*).
//
// The unit suite (lists.test.ts) mocks Prisma, so it proves the route WIRING.
// This proves the T14 acceptance criteria themselves, over the real HTTP route
// and the real database constraint that backs them:
//   - a record can be on MANY lists, each carrying its own entry-only values;
//   - an entry's values never touch the record they are about;
//   - a list holds exactly one object type, verified against a real ObjectDef;
//   - adding the same record twice is idempotent because of the REAL unique
//     constraint (@@unique([listId, objectSlug, targetId])), not just app logic;
//   - org isolation holds.
//
// The app's own Prisma singleton is pointed at this run's schema, so the routes
// run unmodified — the thing under test is the route, not a copy of its body.
// Run with `npm run test:integration`, Docker up.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

// Firebase stays mocked: a test must never reach it, and the bearer token IS the
// firebaseUid, so any seeded user can sign in.
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

// The app's Prisma singleton, aimed at THIS run's schema — the same mechanism the
// guardrail and mailbox integration suites use so the real routes write through it.
vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema })
  return { default: new PrismaClient({ adapter }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const as = (firebaseUid: string): string => `Bearer ${firebaseUid}`

/** A seeded org (real ObjectDefs/AttributeDefs), its admin, and one Person row. */
async function seedOrgWithPerson() {
  const org = await seedOrgWithAdmin(prisma, { seed: true })
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
  const person = await prisma.person.create({ data: { orgId: org.orgId, firstName: 'Jane', lastName: 'Doe' } })
  const personObject = await prisma.objectDef.findFirstOrThrow({
    where: { orgId: org.orgId, slug: 'person' },
  })
  return { org, admin, person, personObject }
}

describe('List + ListEntry (integration, real Postgres, real routes)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // ============================================================
  // Acceptance: a record can be on MANY lists, entry values are the list's own
  // ============================================================
  it('adds the SAME person to TWO lists with DIFFERENT entry values, and touches no Person row', async () => {
    const { org, admin, person, personObject } = await seedOrgWithPerson()

    // A list-scoped field — storage="list" — the kind records.ts excludes from a
    // record's own values and only ListEntry.valuesJson may hold.
    await prisma.attributeDef.create({
      data: {
        orgId: org.orgId, objectId: personObject.id, slug: 'stage', name: 'Stage',
        type: 'text', storage: 'list', sortOrder: 0,
      },
    })

    const listA = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Q3 outbound blitz', objectSlug: 'person' })
    const listB = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Renewal check-ins', objectSlug: 'person' })
    expect(listA.status).toBe(201)
    expect(listB.status).toBe(201)
    expect(listA.body.list.slug).not.toBe(listB.body.list.slug)
    expect(listA.body.list).toMatchObject({ isShared: false, sortOrder: 0 })

    const addTo = (listId: string, stage: string) =>
      request(app)
        .post(`/api/orgs/${org.orgId}/lists/${listId}/entries`)
        .set('Authorization', as(admin.firebaseUid))
        .send({ targetId: person.id, valuesJson: { stage } })

    const entryA = await addTo(listA.body.list.id, 'contacted')
    const entryB = await addTo(listB.body.list.id, 'untouched')

    expect(entryA.status).toBe(201)
    expect(entryB.status).toBe(201)
    // Same person, two lists, two DIFFERENT sets of entry-only values.
    expect(entryA.body.entry.targetId).toBe(person.id)
    expect(entryB.body.entry.targetId).toBe(person.id)
    expect(entryA.body.entry.values).toEqual({ stage: 'contacted' })
    expect(entryB.body.entry.values).toEqual({ stage: 'untouched' })

    // The list read model carries both sources without merging list-only stage
    // onto the Person record: the grid can render the membership as-is.
    const listed = await request(app)
      .get(`/api/orgs/${org.orgId}/lists/${listA.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
    expect(listed.status).toBe(200)
    expect(listed.body.entries[0]).toMatchObject({
      targetId: person.id,
      values: { stage: 'contacted' },
      target: { id: person.id, firstName: 'Jane', lastName: 'Doe' },
    })

    // Confirmed against the real rows, not just the response.
    const rows = await prisma.listEntry.findMany({ where: { orgId: org.orgId, targetId: person.id } })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => (r.valuesJson as { stage: string }).stage).sort()).toEqual([
      'contacted', 'untouched',
    ])

    // The Person row itself carries none of it — there is no such column, and
    // its own fields are exactly what they were seeded with.
    const stillPerson = await prisma.person.findFirstOrThrow({ where: { id: person.id, orgId: org.orgId } })
    expect(stillPerson.firstName).toBe('Jane')
    expect('valuesJson' in stillPerson).toBe(false)

    // Removing a membership is not deleting the underlying CRM object. The
    // process-specific values leave with the entry; the person survives intact.
    const removed = await request(app)
      .delete(`/api/orgs/${org.orgId}/lists/${listA.body.list.id}/entries/${entryA.body.entry.id}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(removed.status).toBe(204)
    await expect(prisma.person.findFirstOrThrow({ where: { id: person.id, orgId: org.orgId } }))
      .resolves.toMatchObject({ id: person.id, firstName: 'Jane', lastName: 'Doe' })
    await expect(prisma.listEntry.count({ where: { orgId: org.orgId, listId: listA.body.list.id } }))
      .resolves.toBe(0)
  })

  // ============================================================
  // Acceptance: a list holds exactly one object type
  // ============================================================
  it('422s adding a target that is not a row of the LIST’S object', async () => {
    const { org, admin, person } = await seedOrgWithPerson()
    const company = await prisma.company.create({ data: { orgId: org.orgId, name: 'Acme' } })

    const list = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'People to call', objectSlug: 'person' })
    expect(list.status).toBe(201)

    // A real company id, on a list of people — refused, not silently accepted.
    const badAdd = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: company.id })
    expect(badAdd.status).toBe(422)

    const goodAdd = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })
    expect(goodAdd.status).toBe(201)
  })

  it('422s creating a list on an objectSlug this org has never defined', async () => {
    const { org, admin } = await seedOrgWithPerson()
    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Ghost list', objectSlug: 'spaceship' })
    expect(res.status).toBe(422)
  })

  // ============================================================
  // Idempotency — backed by the REAL @@unique constraint, not just app logic
  // ============================================================
  it('is idempotent over the wire: the SAME target added twice yields ONE row', async () => {
    const { org, admin, person } = await seedOrgWithPerson()
    const list = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'People to call', objectSlug: 'person' })
    const listId = list.body.list.id

    const first = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${listId}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })
    const second = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${listId}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })

    expect(first.status).toBe(201)
    expect(second.status).toBe(200) // not 201 — nothing new was created
    expect(second.body.entry.id).toBe(first.body.entry.id)

    const count = await prisma.listEntry.count({ where: { orgId: org.orgId, listId, targetId: person.id } })
    expect(count).toBe(1)
  })

  it('the same person can still be on a SECOND list — the unique key is scoped per list', async () => {
    const { org, admin, person } = await seedOrgWithPerson()
    const listA = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'List A', objectSlug: 'person' })
    const listB = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'List B', objectSlug: 'person' })

    const addA = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${listA.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })
    const addB = await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${listB.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })

    expect(addA.status).toBe(201)
    expect(addB.status).toBe(201)
    expect(addA.body.entry.id).not.toBe(addB.body.entry.id)
  })

  it('reorders five entries atomically into contiguous, stable positions', async () => {
    const { org, admin } = await seedOrgWithPerson()
    const people = await Promise.all(
      ['Avery', 'Blake', 'Casey', 'Devon', 'Emery'].map((firstName) =>
        prisma.person.create({ data: { orgId: org.orgId, firstName, lastName: 'List' } }),
      ),
    )
    const list = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Reorderable people', objectSlug: 'person' })
    expect(list.status).toBe(201)

    const entries = await Promise.all(
      people.map((person) =>
        request(app)
          .post(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
          .set('Authorization', as(admin.firebaseUid))
          .send({ targetId: person.id }),
      ),
    )
    expect(entries.every((entry) => entry.status === 201)).toBe(true)

    const orderedIds = entries.map((entry) => entry.body.entry.id).reverse()
    const reordered = await request(app)
      .patch(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ entryIds: orderedIds })

    expect(reordered.status).toBe(204)
    const rows = await prisma.listEntry.findMany({
      where: { orgId: org.orgId, listId: list.body.list.id },
      orderBy: { position: 'asc' },
    })
    expect(rows.map((row) => row.id)).toEqual(orderedIds)
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3, 4])
  })

  it('moves one entry between sparse neighbors without rewriting the rest', async () => {
    const { org, admin } = await seedOrgWithPerson()
    const people = await Promise.all(
      ['Avery', 'Blake', 'Casey'].map((firstName) =>
        prisma.person.create({ data: { orgId: org.orgId, firstName, lastName: 'List' } }),
      ),
    )
    const list = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Sparse people', objectSlug: 'person' })
    expect(list.status).toBe(201)

    const entries = await Promise.all(
      people.map((person) =>
        request(app)
          .post(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
          .set('Authorization', as(admin.firebaseUid))
          .send({ targetId: person.id }),
      ),
    )
    const entryIds = entries.map((entry) => entry.body.entry.id)
    await prisma.listEntry.updateMany({
      where: { orgId: org.orgId, listId: list.body.list.id },
      data: { position: 0 },
    })
    await prisma.listEntry.updateMany({
      where: { orgId: org.orgId, listId: list.body.list.id, id: entryIds[1] },
      data: { position: 1_024 },
    })
    await prisma.listEntry.updateMany({
      where: { orgId: org.orgId, listId: list.body.list.id, id: entryIds[2] },
      data: { position: 2_048 },
    })

    const moved = await request(app)
      .patch(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries/reorder`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ entryId: entryIds[2], beforeEntryId: entryIds[0], afterEntryId: entryIds[1] })

    expect(moved.status).toBe(204)
    const rows = await prisma.listEntry.findMany({
      where: { orgId: org.orgId, listId: list.body.list.id },
      orderBy: { position: 'asc' },
    })
    expect(rows.map((row) => row.id)).toEqual([entryIds[0], entryIds[2], entryIds[1]])
    expect(rows.map((row) => row.position)).toEqual([0, 512, 1_024])
  })

  // ============================================================
  // Trash and org isolation
  // ============================================================
  it('a trashed list’s entries become unreachable, over the real route', async () => {
    const { org, admin, person } = await seedOrgWithPerson()
    const list = await request(app)
      .post(`/api/orgs/${org.orgId}/lists`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ name: 'Temp list', objectSlug: 'person' })
    await request(app)
      .post(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ targetId: person.id })

    const del = await request(app)
      .delete(`/api/orgs/${org.orgId}/lists/${list.body.list.id}`)
      .set('Authorization', as(admin.firebaseUid))
    expect(del.status).toBe(204)

    const entries = await request(app)
      .get(`/api/orgs/${org.orgId}/lists/${list.body.list.id}/entries`)
      .set('Authorization', as(admin.firebaseUid))
    expect(entries.status).toBe(404)

    // The row itself survives the soft delete — a restore would restore it.
    const stillThere = await prisma.listEntry.count({ where: { orgId: org.orgId, listId: list.body.list.id } })
    expect(stillThere).toBe(1)
  })

  it('never crosses the tenant boundary: another org’s list is a 404, not the row', async () => {
    const a = await seedOrgWithPerson()
    const b = await seedOrgWithAdmin(prisma, { seed: true })
    const bAdmin = await prisma.user.findUniqueOrThrow({ where: { id: b.adminUserId } })

    const list = await request(app)
      .post(`/api/orgs/${a.org.orgId}/lists`)
      .set('Authorization', as(a.admin.firebaseUid))
      .send({ name: 'Org A’s list', objectSlug: 'person' })

    const crossOrgRead = await request(app)
      .get(`/api/orgs/${b.orgId}/lists/${list.body.list.id}`)
      .set('Authorization', as(bAdmin.firebaseUid))
    expect(crossOrgRead.status).toBe(404)
  })
})
