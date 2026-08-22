// Real-Postgres proofs for the account-timeline reader (MAI-274).
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedCompany, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('account-timeline read model (integration)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function writeEvent(args: { orgId: string; companyId: string; id: string; occurredAt: Date }) {
    return prisma.activityEntry.create({
      data: {
        id: args.id,
        orgId: args.orgId,
        companyId: args.companyId,
        sourceType: 'call',
        sourceId: `source-${args.id}`,
        summary: `Call ${args.id}`,
        timelineTitle: `Call ${args.id}`,
        occurredAt: args.occurredAt,
      },
    })
  }

  it('cannot cross a tenant boundary even when handed another organization’s account id', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const companyA = await seedCompany(prisma, { orgId: a.orgId })
    const companyB = await seedCompany(prisma, { orgId: b.orgId })
    await writeEvent({ orgId: a.orgId, companyId: companyA.id, id: 'a-event', occurredAt: new Date('2026-08-20T09:30:00.000Z') })
    await writeEvent({ orgId: b.orgId, companyId: companyB.id, id: 'b-event', occurredAt: new Date('2026-08-20T09:30:00.000Z') })

    const rows = await prisma.activityEntry.findMany({
      where: {
        orgId: a.orgId,
        companyId: companyB.id,
        occurredAt: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lt: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
    })

    expect(rows).toEqual([])
  })

  it('plans the half-open Company timeline range through its composite ActivityEntry index', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId })
    const schema = inject('testSchema')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."ActivityEntry"
         ("id", "orgId", "sourceType", "sourceId", "summary", "timelineTitle", "occurredAt", "updatedAt")
       SELECT 'account-timeline-noise-' || i, '${orgId}', 'call', 'account-timeline-noise-source-' || i, 'Noise ' || i, 'Noise ' || i,
              TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '1 minute'), NOW()
       FROM generate_series(1, 20000) AS i`,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."ActivityEntry"
         ("id", "orgId", "companyId", "sourceType", "sourceId", "summary", "timelineTitle", "occurredAt", "updatedAt")
       SELECT 'account-timeline-event-' || i, '${orgId}', '${company.id}', 'call', 'account-timeline-event-source-' || i,
              'Timeline ' || i, 'Timeline ' || i,
              TIMESTAMP '2026-08-01 00:00:00' + (i * INTERVAL '1 hour'), NOW()
       FROM generate_series(1, 100) AS i`,
    )
    await prisma.$executeRawUnsafe(`ANALYZE "${schema}"."ActivityEntry"`)

    const plan = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `EXPLAIN SELECT * FROM "${schema}"."ActivityEntry"
       WHERE "orgId" = '${orgId}' AND "companyId" = '${company.id}'
         AND "occurredAt" >= TIMESTAMP '2026-08-01 00:00:00'
         AND "occurredAt" < TIMESTAMP '2026-09-01 00:00:00'
       ORDER BY "occurredAt" DESC LIMIT 50`,
    )
    const text = plan.map((row) => Object.values(row)[0]).join('\n')

    expect(text).toMatch(/Index Scan.*ActivityEntry_orgId_companyId_occurredAt_idx/s)
    expect(text).not.toMatch(/\bJoin\b/)
    expect(text).not.toMatch(/Seq Scan/)
  })
})
