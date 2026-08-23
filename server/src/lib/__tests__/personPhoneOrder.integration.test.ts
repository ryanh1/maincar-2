import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { resolveNextUsablePersonPhoneForPerson } from '../personPhoneOrder.js'

describe('resolveNextUsablePersonPhoneForPerson (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('uses only this tenant’s rows and skips DNC, dead, and attempted numbers', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const personA = await prisma.person.create({ data: { orgId: orgA.orgId, firstName: 'Avery' } })
    const personB = await prisma.person.create({ data: { orgId: orgB.orgId, firstName: 'Blair' } })

    await prisma.personPhone.createMany({ data: [
      { orgId: orgA.orgId, personId: personA.id, e164: '+12025550100', position: 0, isPrimary: true, isDnc: true },
      { orgId: orgA.orgId, personId: personA.id, e164: '+12025550101', position: 1, status: 'dead' },
      { orgId: orgA.orgId, personId: personA.id, e164: '+12025550102', position: 2 },
      { orgId: orgB.orgId, personId: personB.id, e164: '+12025550103', position: 0, isPrimary: true },
    ] })
    const eligible = await prisma.personPhone.findFirstOrThrow({
      where: { orgId: orgA.orgId, personId: personA.id, position: 2 },
    })

    expect(await resolveNextUsablePersonPhoneForPerson(prisma, {
      orgId: orgA.orgId,
      personId: personA.id,
      attemptedPhoneIds: [],
    })).toMatchObject({ kind: 'phone', phone: { id: eligible.id } })
    expect(await resolveNextUsablePersonPhoneForPerson(prisma, {
      orgId: orgA.orgId,
      personId: personA.id,
      attemptedPhoneIds: [eligible.id],
    })).toEqual({ kind: 'exhausted' })
    expect(await resolveNextUsablePersonPhoneForPerson(prisma, {
      orgId: orgA.orgId,
      personId: personB.id,
      attemptedPhoneIds: [],
    })).toEqual({ kind: 'exhausted' })
  })
})
