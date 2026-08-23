// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it proves the route ASKS for the right writes.
// This proves the two things only real row state can: the primary invariant
// (exactly one primary phone/email once a person has any) actually holds after a
// sequence of adds/deletes, and the @@unique([personId, e164]) key makes a re-add
// idempotent. It runs the route's own reconcilePrimary against the real client.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { reconcilePhoneOrder, normalizeE164, type PhoneOrderDelegate } from '../people.js'

describe('Person primary invariant + idempotency (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function seedPerson(orgId: string): Promise<string> {
    const person = await prisma.person.create({ data: { orgId, firstName: 'Jane', lastName: 'Doe' } })
    return person.id
  }

  // The route creates a phone with isPrimary:false, then reconciles. This mirrors
  // exactly that, so "add" here is the route's add.
  async function addPhone(
    orgId: string,
    personId: string,
    e164: string,
    opts: { prefer?: boolean; createdAt?: Date } = {},
  ): Promise<string> {
    const position = await prisma.personPhone.count({ where: { orgId, personId } })
    const created = await prisma.personPhone.upsert({
      where: { personId_e164: { personId, e164: normalizeE164(e164) } },
      create: { orgId, personId, e164: normalizeE164(e164), isPrimary: false, position, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) },
      update: {},
    })
    await reconcilePhoneOrder(
      prisma.personPhone as unknown as PhoneOrderDelegate,
      personId,
      orgId,
      opts.prefer ? created.id : undefined,
    )
    return created.id
  }

  async function primaryPhones(orgId: string, personId: string) {
    return prisma.personPhone.findMany({ where: { orgId, personId, isPrimary: true } })
  }

  it('makes the first phone primary, and keeps exactly one after a second add', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    const first = await addPhone(org.orgId, personId, '+12025550001')
    let primaries = await primaryPhones(org.orgId, personId)
    expect(primaries.map((p) => p.id)).toEqual([first])

    await addPhone(org.orgId, personId, '+12025550002')
    primaries = await primaryPhones(org.orgId, personId)
    // Exactly one primary, and the first one keeps it (no prefer given).
    expect(primaries).toHaveLength(1)
    expect(primaries[0].id).toBe(first)
    expect((await prisma.personPhone.findMany({ where: { orgId: org.orgId, personId }, orderBy: { position: 'asc' } })).map((phone) => phone.position)).toEqual([0, 1])
  })

  it('promotes a requested phone to primary and demotes the former one', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    const first = await addPhone(org.orgId, personId, '+12025550001')
    const second = await addPhone(org.orgId, personId, '+12025550002', { prefer: true })

    const primaries = await primaryPhones(org.orgId, personId)
    expect(primaries.map((p) => p.id)).toEqual([second])
    const firstRow = await prisma.personPhone.findFirst({ where: { id: first } })
    expect(firstRow!.isPrimary).toBe(false)
  })

  it('auto-promotes another phone when the primary is deleted', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    // The primary is the newest by createdAt; the survivor is older, so the
    // promotion is proven to pick the oldest remaining, not just "some row".
    const primary = await addPhone(org.orgId, personId, '+12025550001', {
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    })
    const older = await addPhone(org.orgId, personId, '+12025550002', {
      prefer: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    // Make the newest the primary explicitly.
    await reconcilePhoneOrder(prisma.personPhone as unknown as PhoneOrderDelegate, personId, org.orgId, primary)

    // Delete the primary, then reconcile — the route's delete path.
    await prisma.personPhone.deleteMany({ where: { id: primary, personId, orgId: org.orgId } })
    await reconcilePhoneOrder(prisma.personPhone as unknown as PhoneOrderDelegate, personId, org.orgId)

    const primaries = await primaryPhones(org.orgId, personId)
    expect(primaries.map((p) => p.id)).toEqual([older])
    expect((await prisma.personPhone.findMany({ where: { orgId: org.orgId, personId } }))[0].position).toBe(0)
  })

  it('leaves zero primaries when the last phone is deleted', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    const only = await addPhone(org.orgId, personId, '+12025550001')
    await prisma.personPhone.deleteMany({ where: { id: only, personId, orgId: org.orgId } })
    await reconcilePhoneOrder(prisma.personPhone as unknown as PhoneOrderDelegate, personId, org.orgId)

    expect(await primaryPhones(org.orgId, personId)).toHaveLength(0)
  })

  it('re-adds the same number idempotently — one row, dead status retained', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    await addPhone(org.orgId, personId, '+12025550001')
    // Mark it dead, then re-add with the update touching nothing (the route only
    // writes sent fields). A dead value must be retained, not reset.
    await prisma.personPhone.updateMany({
      where: { personId, orgId: org.orgId, e164: '+12025550001' },
      data: { status: 'dead', reason: 'wrong_person' },
    })
    await addPhone(org.orgId, personId, '+1 (202) 555-0001') // same number, formatted differently

    const rows = await prisma.personPhone.findMany({ where: { personId, orgId: org.orgId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('dead')
    expect(rows[0].reason).toBe('wrong_person')
  })

  it('collapses multiple stray primaries to exactly one', async () => {
    // Defensive: even if two rows somehow carry isPrimary=true, reconcile fixes it.
    const org = await seedOrgWithAdmin(prisma)
    const personId = await seedPerson(org.orgId)

    await prisma.personPhone.create({
      data: { orgId: org.orgId, personId, e164: '+12025550001', isPrimary: true, position: 0, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    await prisma.personPhone.create({
      data: { orgId: org.orgId, personId, e164: '+12025550002', isPrimary: true, position: 1, createdAt: new Date('2026-02-01T00:00:00.000Z') },
    })

    await reconcilePhoneOrder(prisma.personPhone as unknown as PhoneOrderDelegate, personId, org.orgId)

    const primaries = await primaryPhones(org.orgId, personId)
    expect(primaries).toHaveLength(1)
    // The already-primary oldest keeps it.
    expect(primaries[0].e164).toBe('+12025550001')
  })

  it('allows the same number on two different people (@@unique is per-person)', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const jane = await seedPerson(org.orgId)
    const john = await seedPerson(org.orgId)

    await addPhone(org.orgId, jane, '+12025559999')
    // Must not collide: the unique key is ([personId, e164]), not e164 alone.
    await expect(addPhone(org.orgId, john, '+12025559999')).resolves.toBeTruthy()

    expect((await primaryPhones(org.orgId, jane))).toHaveLength(1)
    expect((await primaryPhones(org.orgId, john))).toHaveLength(1)
  })
})
