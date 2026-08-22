// MAI-143's reporting path against a real PostgreSQL schema. The unit test
// proves the response contract; this proves that the registry/compiler query
// returns the hand-checked total and cannot read another org's Deals.
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
  // Raw report SQL needs the session search path, while Prisma-generated
  // membership queries use the adapter schema option.
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return { default: new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
}

function authorization(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

async function createPipelineAndStages(orgId: string) {
  const pipeline = await prisma.pipeline.create({ data: { orgId, name: 'Sales' } })
  const [discovery, proposal] = await Promise.all([
    prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Discovery', sortOrder: 1 } }),
    prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Proposal', sortOrder: 2 } }),
  ])
  return { pipeline, discovery, proposal }
}

describe('POST /api/orgs/:orgId/reports/run (integration)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns the hand-checked Deals total by stage and excludes another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const { pipeline, discovery, proposal } = await createPipelineAndStages(orgA.orgId)
    await prisma.deal.createMany({
      data: [
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'A', amountMinor: 1200n },
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'B', amountMinor: 2300n },
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: proposal.id, name: 'C', amountMinor: 9000n },
      ],
    })

    const orgB = await seedOrgWithAdmin(prisma)
    const other = await createPipelineAndStages(orgB.orgId)
    await prisma.deal.create({
      data: { orgId: orgB.orgId, pipelineId: other.pipeline.id, stageId: other.discovery.id, name: 'Foreign', amountMinor: 999999n },
    })

    const response = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({ config: CONFIG })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { stageId: discovery.id, stageName: 'Discovery', amountMinor: '3500' },
      { stageId: proposal.id, stageName: 'Proposal', amountMinor: '9000' },
    ])
    // 1,200 + 2,300 + 9,000 = 12,500. This assertion names the arithmetic so
    // the fixture remains a human-auditable correctness check, not just a copy
    // of the implementation's grouped output.
    expect(response.body.report.rows.reduce((sum: bigint, row: { amountMinor: string }) => sum + BigInt(row.amountMinor), 0n))
      .toBe(12500n)
  })
})
