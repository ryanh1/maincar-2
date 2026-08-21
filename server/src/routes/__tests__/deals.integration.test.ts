// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it proves the route ASKS for the right writes.
// This proves the things only real row state and real constraints can (MAI-131,
// T3 acceptance criteria):
//   - amountMinor (BigInt) round-trips a value beyond 2^53 with no float drift;
//   - a deal + two DealPersonRole rows read back correctly;
//   - the SAME person is champion on deal A and influencer on deal B;
//   - @@unique([dealId, personId]) blocks the same person twice on ONE deal;
//   - onDelete: Restrict stops a pipeline/stage being deleted out from under a
//     deal that still points at it.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('Deal spine (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // Seeds a default pipeline with one stage — the minimum a deal needs, standing
  // in for the seedOrg step that lands in T6.
  async function seedPipeline(orgId: string): Promise<{ pipelineId: string; stageId: string }> {
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: 'New Business', isDefault: true },
    })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1, winProbability: 40 },
    })
    return { pipelineId: pipeline.id, stageId: stage.id }
  }

  async function seedPerson(orgId: string, firstName: string): Promise<string> {
    const person = await prisma.person.create({ data: { orgId, firstName } })
    return person.id
  }

  it('round-trips amountMinor beyond 2^53 with no float drift', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { pipelineId, stageId } = await seedPipeline(orgId)

    // 2^53 + 1 — a value a JS number cannot hold exactly.
    const amount = 9_007_199_254_740_993n
    const deal = await prisma.deal.create({
      data: { orgId, name: 'Big deal', pipelineId, stageId, amountMinor: amount, currency: 'USD' },
    })

    const read = await prisma.deal.findFirstOrThrow({ where: { id: deal.id, orgId } })
    expect(read.amountMinor).toBe(amount)
    expect(read.amountMinor?.toString()).toBe('9007199254740993')
  })

  it('creates a deal, attaches two person-roles, and reads them back', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { pipelineId, stageId } = await seedPipeline(orgId)
    const champ = await seedPerson(orgId, 'Cam')
    const influencer = await seedPerson(orgId, 'Ivy')

    const deal = await prisma.deal.create({ data: { orgId, name: 'Acme', pipelineId, stageId } })
    await prisma.dealPersonRole.create({
      data: { orgId, dealId: deal.id, personId: champ, role: 'champion', isPrimary: true },
    })
    await prisma.dealPersonRole.create({
      data: { orgId, dealId: deal.id, personId: influencer, role: 'influencer' },
    })

    const withRoles = await prisma.deal.findFirstOrThrow({
      where: { id: deal.id, orgId },
      include: { personRoles: { orderBy: { role: 'asc' } } },
    })
    expect(withRoles.personRoles).toHaveLength(2)
    expect(withRoles.personRoles.map((r) => r.role).sort()).toEqual(['champion', 'influencer'])
  })

  it('lets the same person be champion on deal A and influencer on deal B', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { pipelineId, stageId } = await seedPipeline(orgId)
    const personId = await seedPerson(orgId, 'Sam')

    const dealA = await prisma.deal.create({ data: { orgId, name: 'A', pipelineId, stageId } })
    const dealB = await prisma.deal.create({ data: { orgId, name: 'B', pipelineId, stageId } })

    await prisma.dealPersonRole.create({
      data: { orgId, dealId: dealA.id, personId, role: 'champion' },
    })
    await prisma.dealPersonRole.create({
      data: { orgId, dealId: dealB.id, personId, role: 'influencer' },
    })

    const roles = await prisma.dealPersonRole.findMany({ where: { orgId, personId }, orderBy: { role: 'asc' } })
    expect(roles.map((r) => r.role)).toEqual(['champion', 'influencer'])
  })

  it('blocks the same person appearing twice on ONE deal (@@unique[dealId, personId])', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { pipelineId, stageId } = await seedPipeline(orgId)
    const personId = await seedPerson(orgId, 'Dup')
    const deal = await prisma.deal.create({ data: { orgId, name: 'Solo', pipelineId, stageId } })

    await prisma.dealPersonRole.create({ data: { orgId, dealId: deal.id, personId, role: 'champion' } })
    await expect(
      prisma.dealPersonRole.create({ data: { orgId, dealId: deal.id, personId, role: 'blocker' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('refuses to delete a pipeline/stage still referenced by a deal (onDelete: Restrict)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { pipelineId, stageId } = await seedPipeline(orgId)
    await prisma.deal.create({ data: { orgId, name: 'Live', pipelineId, stageId } })

    await expect(prisma.pipelineStage.delete({ where: { id: stageId } })).rejects.toMatchObject({
      code: 'P2003',
    })
    await expect(prisma.pipeline.delete({ where: { id: pipelineId } })).rejects.toMatchObject({
      code: 'P2003',
    })
  })
})
