import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    savedView: { findFirst: vi.fn() },
    attributeDef: { findFirst: vi.fn() },
    colorRule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
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

const NOW = new Date('2026-08-22T18:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/color-rules`

function userRow() {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, avatarKey: null, roles: ['basic'], enabled: true,
    timeZone: 'America/New_York', currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
  }
}

function membershipRow() {
  return {
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function savedViewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'view-1', orgId: ORG_ID, objectId: 'object-people', ownerUserId: 'user-a',
    name: 'Prospects', layout: 'grid', configJson: { version: 1, columns: [] },
    isShared: false, isDefault: false, sortOrder: 0, deletedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function colorRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1', orgId: ORG_ID, viewId: 'view-1', attribute: 'attribute-date',
    predicate: { op: 'before_today' }, target: 'background', scope: 'cell', color: 'option-5',
    sortOrder: 0, isDefault: true, enabled: true, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow())
  prismaMock.attributeDef.findFirst.mockResolvedValue({
    id: 'attribute-date', objectId: 'object-people', storage: 'column', isMulti: false, type: 'date',
  })
  prismaMock.colorRule.findFirst.mockResolvedValue(colorRuleRow())
  prismaMock.colorRule.findMany.mockResolvedValue([colorRuleRow()])
  prismaMock.colorRule.create.mockImplementation(async (args: { data: Record<string, unknown> }) => colorRuleRow(args.data))
  prismaMock.colorRule.createMany.mockResolvedValue({ count: 3 })
  prismaMock.colorRule.update.mockImplementation(async (args: { data: Record<string, unknown> }) => colorRuleRow(args.data))
  prismaMock.colorRule.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.colorRule.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops))
})

describe('GET /api/orgs/:orgId/color-rules', () => {
  it('lists the ordered rules of one visible view', async () => {
    const response = await request(app)
      .get(`${URL}?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.colorRules).toEqual([
      expect.objectContaining({ viewId: 'view-1', attribute: 'attribute-date', color: 'option-5' }),
    ])
    expect(prismaMock.colorRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: ORG_ID, viewId: 'view-1' },
    }))
  })

  it('seeds the temperature rules when the view has no default rule yet', async () => {
    prismaMock.colorRule.findFirst.mockResolvedValue(null)

    const response = await request(app)
      .get(`${URL}?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(prismaMock.colorRule.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ predicate: { op: 'before_today' }, color: 'option-5', isDefault: true }),
        expect.objectContaining({ predicate: { op: 'is_today' }, color: 'option-6', isDefault: true }),
        expect.objectContaining({ predicate: { op: 'after_today' }, color: 'option-7', isDefault: true }),
      ]),
    }))
  })

  it('hides a view the caller cannot see', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow({ ownerUserId: 'someone-else', isShared: false }))

    const response = await request(app)
      .get(`${URL}?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.colorRule.findMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/orgs/:orgId/color-rules', () => {
  it('creates a rule with a typed predicate', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', attribute: 'attribute-date', predicate: { op: 'eq', value: 'At risk' }, target: 'text', scope: 'cell', color: 'option-1' })

    expect(response.status).toBe(201)
    expect(response.body.colorRule).toMatchObject({ target: 'text', color: 'option-1' })
    expect(prismaMock.colorRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: ORG_ID, predicate: { op: 'eq', value: 'At risk' } }),
    }))
  })

  it('rejects a predicate that needs a value but has none', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', attribute: 'attribute-date', predicate: { op: 'gt' }, target: 'background', color: 'option-1' })

    expect(response.status).toBe(422)
    expect(prismaMock.colorRule.create).not.toHaveBeenCalled()
  })

  it('rejects an unknown colour token', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', attribute: 'attribute-date', predicate: { op: 'is_today' }, target: 'background', color: '#ff0000' })

    expect(response.status).toBe(422)
    expect(prismaMock.colorRule.create).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/orgs/:orgId/color-rules/:id', () => {
  it('edits a rule without touching its default flag', async () => {
    const response = await request(app)
      .patch(`${URL}/rule-1`)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', color: 'option-2' })

    expect(response.status).toBe(200)
    expect(prismaMock.colorRule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ color: 'option-2' }),
    }))
  })
})

describe('DELETE /api/orgs/:orgId/color-rules/:id', () => {
  it('removes a rule from its view', async () => {
    const response = await request(app)
      .delete(`${URL}/rule-1?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(204)
    expect(prismaMock.colorRule.deleteMany).toHaveBeenCalledWith({
      where: { id: 'rule-1', viewId: 'view-1', orgId: ORG_ID },
    })
  })
})

describe('POST /api/orgs/:orgId/color-rules/reorder', () => {
  it('reorders the submitted rule set', async () => {
    prismaMock.colorRule.findMany.mockResolvedValue([colorRuleRow(), colorRuleRow({ id: 'rule-2' })])

    const response = await request(app)
      .post(`${URL}/reorder`)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', ruleIds: ['rule-2', 'rule-1'] })

    expect(response.status).toBe(204)
    expect(prismaMock.colorRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rule-2', viewId: 'view-1', orgId: ORG_ID }, data: { sortOrder: 0 },
    }))
  })
})

describe('POST /api/orgs/:orgId/color-rules/restore-defaults', () => {
  it('resets the seeded set', async () => {
    const response = await request(app)
      .post(`${URL}/restore-defaults`)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1' })

    expect(response.status).toBe(200)
    expect(prismaMock.colorRule.deleteMany).toHaveBeenCalledWith({
      where: { viewId: 'view-1', orgId: ORG_ID, isDefault: true },
    })
  })
})
