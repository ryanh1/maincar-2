import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedCall, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

let prisma: PrismaClient
let app: express.Express
let activeUserId = ''

function nextStepsUrl(orgId: string) {
  return `/api/orgs/${orgId}/next-steps`
}

beforeAll(async () => {
  prisma = createTestPrisma()
  vi.resetModules()
  vi.doMock('../../db.js', () => ({ default: prisma }))
  vi.doMock('../../middleware/auth.js', () => ({
    requireAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
      ;(req as express.Request & { user?: { id: string } }).user = { id: activeUserId }
      next()
    },
  }))
  const [{ default: nextStepsRouter, callNextStepsRouter }, { default: callsRouter }] = await Promise.all([
    import('../nextSteps.js'), import('../calls.js'),
  ])
  app = express()
  app.use(express.json())
  app.use('/api/orgs/:orgId/next-steps', nextStepsRouter)
  app.use('/api/orgs/:orgId/calls/:callId/next-steps', callNextStepsRouter)
  app.use('/api/orgs/:orgId/calls', callsRouter)
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(() => {
  activeUserId = ''
})

describe('next-step persistence (integration, real Postgres)', () => {
  it('creates types, saves two selected steps on one call, and reads them back without changing its disposition', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, status: 'completed' })
    activeUserId = org.adminUserId

    const callback = await request(app)
      .post(`${nextStepsUrl(org.orgId)}/types`)
      .send({ value: 'callback', label: 'Callback', color: 'option-3', icon: 'PhoneCall', requiresDateTime: true, createsTask: true })
      .expect(201)
    const email = await request(app)
      .post(`${nextStepsUrl(org.orgId)}/types`)
      .send({ value: 'send_email', label: 'Send email', color: 'option-2', icon: 'Mail' })
      .expect(201)
    const scheduledAt = '2026-08-24T15:00:00.000Z'

    await request(app)
      .put(`/api/orgs/${org.orgId}/calls/${call.id}/next-steps`)
      .send({ nextSteps: [
        { nextStepTypeId: callback.body.type.id, scheduledAt },
        { nextStepTypeId: email.body.type.id },
      ] })
      .expect(200)

    const reread = await request(app).get(`/api/orgs/${org.orgId}/calls/${call.id}`).expect(200)
    expect(reread.body.call.disposition).toBeNull()
    expect(reread.body.call.nextSteps).toEqual([
      expect.objectContaining({ scheduledAt, nextStepType: expect.objectContaining({ value: 'callback', requiresDateTime: true, createsTask: true }) }),
      expect.objectContaining({ scheduledAt: null, nextStepType: expect.objectContaining({ value: 'send_email' }) }),
    ])
  })

  it('does not accept an archived or another organization’s type as a disposition suggestion', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const disposition = await prisma.dispositionDef.create({
      data: { orgId: a.orgId, value: 'no_answer', label: 'No answer', color: 'option-1', category: 'not_connected' },
    })
    const type = await prisma.nextStepType.create({
      data: { orgId: a.orgId, value: 'callback', label: 'Callback', color: 'option-3', requiresDateTime: true },
    })
    const otherOrgType = await prisma.nextStepType.create({
      data: { orgId: b.orgId, value: 'callback', label: 'Callback', color: 'option-3' },
    })
    activeUserId = a.adminUserId

    await request(app)
      .put(`${nextStepsUrl(a.orgId)}/rules/${disposition.id}`)
      .send({ nextStepTypeId: otherOrgType.id })
      .expect(400)

    await request(app).patch(`${nextStepsUrl(a.orgId)}/types/${type.id}`).send({ isArchived: true }).expect(200)
    await request(app)
      .put(`${nextStepsUrl(a.orgId)}/rules/${disposition.id}`)
      .send({ nextStepTypeId: type.id })
      .expect(400)
    expect(await prisma.dispositionNextStepRule.count({ where: { orgId: a.orgId, dispositionId: disposition.id } })).toBe(0)
  })
})
