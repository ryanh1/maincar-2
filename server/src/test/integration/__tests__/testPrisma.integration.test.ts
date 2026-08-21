// The integration suite's own org factory, tested (MAI-136).
//
// `seedOrgWithAdmin` gives a BARE org by default — no ObjectDefs, no AttributeDefs,
// no pipeline — which is what ~all existing route tests want and rely on for speed.
// `{ seed: true }` opts into the REAL standard-schema seed, so a test that reads or
// writes through the schema-as-data layer can have an org shaped like a production
// one. This pins both halves: the default must stay off, and the opt-in must run
// the same seedOrgInTx org creation runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_SEED_VERSION, DEFAULT_PIPELINE, STANDARD_OBJECTS } from '../../../crm/standardObjects.js'
import type { PrismaClient } from '../../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../testPrisma.js'

describe('seedOrgWithAdmin (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('seeds NO standard schema by default', async () => {
    const org = await seedOrgWithAdmin(prisma)

    expect(await prisma.objectDef.count({ where: { orgId: org.orgId } })).toBe(0)
    expect(await prisma.attributeDef.count({ where: { orgId: org.orgId } })).toBe(0)
    expect(await prisma.pipeline.count({ where: { orgId: org.orgId } })).toBe(0)
    const row = await prisma.org.findFirst({ where: { id: org.orgId } })
    expect(row!.seedVersion).toBe(0)
  })

  it('gives the org the real standard schema and default pipeline with { seed: true }', async () => {
    const org = await seedOrgWithAdmin(prisma, { seed: true })

    const objects = await prisma.objectDef.findMany({ where: { orgId: org.orgId } })
    expect(objects.map((o) => o.slug).sort()).toEqual(STANDARD_OBJECTS.map((o) => o.slug).sort())
    expect(await prisma.attributeDef.count({ where: { orgId: org.orgId } })).toBe(
      STANDARD_OBJECTS.reduce((n, o) => n + o.attributes.length, 0),
    )

    const pipelines = await prisma.pipeline.findMany({ where: { orgId: org.orgId } })
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0].name).toBe(DEFAULT_PIPELINE.name)
    expect(await prisma.pipelineStage.count({ where: { orgId: org.orgId } })).toBe(
      DEFAULT_PIPELINE.stages.length,
    )

    const row = await prisma.org.findFirst({ where: { id: org.orgId } })
    expect(row!.seedVersion).toBe(CURRENT_SEED_VERSION)
  })
})
