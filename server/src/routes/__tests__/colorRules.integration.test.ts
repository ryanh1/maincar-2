// Real-Postgres coverage for color rules. The unit suite proves route wiring;
// these tests prove the idempotent due-date temperature seeding and that a
// user's edits to a default rule are never clobbered by a later seed run.
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
  const view = await prisma.savedView.create({
    data: { orgId: org.orgId, objectId: object.id, ownerUserId: admin.id, name: 'Prospects', layout: 'grid', configJson: { columns: [] } },
  })
  return { org, admin, object, view }
}

describe('ColorRule (integration, real Postgres, real routes)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('seeds the due-date temperature rules idempotently and never clobbers edits', async () => {
    const { org, admin, view } = await seedViewContext()

    // First read seeds the three temperature rules against the object's date field.
    const first = await request(app)
      .get(`/api/orgs/${org.orgId}/color-rules?viewId=${view.id}`)
      .set('Authorization', as(admin.firebaseUid))

    expect(first.status).toBe(200)
    expect(first.body.colorRules).toHaveLength(3)
    expect(first.body.colorRules.every((rule: { isDefault: boolean }) => rule.isDefault)).toBe(true)
    const ops = first.body.colorRules.map((rule: { predicate: { op: string } }) => rule.predicate.op).sort()
    expect(ops).toEqual(['after_today', 'before_today', 'is_today'])

    // A second read is a no-op: still exactly three default rules.
    const second = await request(app)
      .get(`/api/orgs/${org.orgId}/color-rules?viewId=${view.id}`)
      .set('Authorization', as(admin.firebaseUid))

    expect(second.status).toBe(200)
    expect(second.body.colorRules).toHaveLength(3)

    // Edit a default rule's colour; a later read must not clobber it.
    const overdue = second.body.colorRules.find((rule: { predicate: { op: string } }) => rule.predicate.op === 'before_today')
    const edited = await request(app)
      .patch(`/api/orgs/${org.orgId}/color-rules/${overdue.id}`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ viewId: view.id, color: 'option-1' })

    expect(edited.status).toBe(200)
    expect(edited.body.colorRule.color).toBe('option-1')

    const third = await request(app)
      .get(`/api/orgs/${org.orgId}/color-rules?viewId=${view.id}`)
      .set('Authorization', as(admin.firebaseUid))

    const overdueAfter = third.body.colorRules.find((rule: { predicate: { op: string } }) => rule.predicate.op === 'before_today')
    expect(overdueAfter.color).toBe('option-1')

    // Restore defaults resets the seeded set back to the temperature colours.
    const restored = await request(app)
      .post(`/api/orgs/${org.orgId}/color-rules/restore-defaults`)
      .set('Authorization', as(admin.firebaseUid))
      .send({ viewId: view.id })

    expect(restored.status).toBe(200)
    const restoredOverdue = restored.body.colorRules.find((rule: { predicate: { op: string } }) => rule.predicate.op === 'before_today')
    expect(restoredOverdue.color).toBe('option-5')
  })

  it('keeps rules scoped to their view', async () => {
    const { org, admin, object, view } = await seedViewContext()
    const otherView = await prisma.savedView.create({
      data: { orgId: org.orgId, objectId: object.id, ownerUserId: admin.id, name: 'Other', layout: 'grid', configJson: { columns: [] } },
    })

    await request(app)
      .get(`/api/orgs/${org.orgId}/color-rules?viewId=${view.id}`)
      .set('Authorization', as(admin.firebaseUid))

    const other = await request(app)
      .get(`/api/orgs/${org.orgId}/color-rules?viewId=${otherView.id}`)
      .set('Authorization', as(admin.firebaseUid))

    expect(other.status).toBe(200)
    expect(other.body.colorRules).toHaveLength(3)
    expect(other.body.colorRules.every((rule: { viewId: string }) => rule.viewId === otherView.id)).toBe(true)
  })
})
