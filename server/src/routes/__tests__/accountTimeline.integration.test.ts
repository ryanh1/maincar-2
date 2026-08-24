// Real-Postgres proofs for the account-timeline reader (MAI-274).
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import {
  ACTIVITY_SOURCE_TYPES,
  recordActivityInTx,
  type ActivitySourceType,
} from '../../crm/activityFeed.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedCompany, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const SHIPPED_TIMELINE_SOURCE_TYPES = [
  'call',
  'email',
  'sms',
  'meeting',
  'note',
  'stage_change',
  'task',
  'record_created',
  'custom',
] as const satisfies readonly ActivitySourceType[]

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

  it('reconciles every shipped source to one self-rendering account event', async () => {
    expect(
      ACTIVITY_SOURCE_TYPES,
      'A new upstream activity family must be added to the account-timeline reconciliation fixture.',
    ).toEqual(SHIPPED_TIMELINE_SOURCE_TYPES)

    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId })
    const occurredAt = new Date('2026-08-20T09:30:00.000Z')

    await prisma.$transaction(async (tx) => {
      for (const [index, sourceType] of SHIPPED_TIMELINE_SOURCE_TYPES.entries()) {
        const sourceId = `${sourceType}-source`
        const event = {
          orgId,
          companyId: company.id,
          sourceType,
          sourceId,
          summary: `${sourceType} first projection`,
          occurredAt: new Date(occurredAt.getTime() + index * 60_000),
          timeline: {
            version: 1 as const,
            title: `${sourceType} timeline event`,
            intensity: 2 as const,
            display: { companyName: 'Reconciliation account' },
          },
        }

        await recordActivityInTx(tx, event)
        await recordActivityInTx(tx, { ...event, summary: `${sourceType} refreshed projection` })
      }
    })

    const rows = await prisma.activityEntry.findMany({
      where: {
        orgId,
        companyId: company.id,
        occurredAt: {
          gte: new Date('2026-08-20T00:00:00.000Z'),
          lt: new Date('2026-08-21T00:00:00.000Z'),
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    })

    expect(rows).toHaveLength(SHIPPED_TIMELINE_SOURCE_TYPES.length)
    expect(new Set(rows.map((row) => `${row.sourceType}:${row.sourceId}`)).size).toBe(
      SHIPPED_TIMELINE_SOURCE_TYPES.length,
    )
    expect(rows.map((row) => row.sourceType).sort()).toEqual([...SHIPPED_TIMELINE_SOURCE_TYPES].sort())
    expect(rows.every((row) => row.summary.endsWith('refreshed projection'))).toBe(true)
    expect(rows.every((row) => row.timelineTitle.endsWith('timeline event'))).toBe(true)
  })

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
