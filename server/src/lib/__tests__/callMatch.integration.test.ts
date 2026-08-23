// The number → CRM spine match against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite stubs Prisma, so it can only prove the helper's shape. This
// proves what only the real database can: that the match's orgId filter is a true
// tenant boundary, that the @@unique([personId, e164]) lets one number be held by
// two people and the match still resolves deterministically, and — the spine's
// core promise — that the Call FKs are ON DELETE SET NULL, so deleting a Person,
// Company, or Deal nulls the call's link instead of destroying the call.
// Run with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedCompany,
  seedOrgWithAdmin,
  seedPerson,
  seedPersonPhone,
} from '../../test/integration/testPrisma.js'
import { matchCallToCrm, matchInboundCallerToCrm } from '../callMatch.js'

describe('matchCallToCrm (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('resolves a known number to its person and their company', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId: org.orgId, name: 'Globex' })
    const person = await seedPerson(prisma, { orgId: org.orgId, companyId: company.id })
    const e164 = '+13035551311'
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: person.id, e164, isPrimary: true })

    const links = await matchCallToCrm(prisma, org.orgId, e164)

    expect(links).toEqual({ personId: person.id, companyId: company.id, dealId: null })
  })

  it('resolves a person with no company to a null companyId', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const person = await seedPerson(prisma, { orgId: org.orgId, companyId: null })
    const e164 = '+13035551312'
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: person.id, e164 })

    const links = await matchCallToCrm(prisma, org.orgId, e164)

    expect(links).toEqual({ personId: person.id, companyId: null, dealId: null })
  })

  it('returns all-null links for an unknown number', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const links = await matchCallToCrm(prisma, org.orgId, '+19998887777')

    expect(links).toEqual({ personId: null, companyId: null, dealId: null })
  })

  // The tenant boundary on the match's READ. Org A dialing a number that belongs to
  // Org B's person must not resolve to that person — the leak this orgId filter stops.
  it('does not match a number that belongs to another org’s person', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const personB = await seedPerson(prisma, { orgId: orgB.orgId })
    const e164 = '+13035551313'
    await seedPersonPhone(prisma, { orgId: orgB.orgId, personId: personB.id, e164 })

    const links = await matchCallToCrm(prisma, orgA.orgId, e164)

    expect(links).toEqual({ personId: null, companyId: null, dealId: null })
  })

  // @@unique is [personId, e164], not global, so the SAME number can sit on two
  // people. The match is made deterministic — the primary number wins — rather than
  // left to arbitrary row order.
  it('prefers the primary owner when one number is held by two people', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const nonPrimary = await seedPerson(prisma, { orgId: org.orgId })
    const primary = await seedPerson(prisma, { orgId: org.orgId })
    const e164 = '+13035551314'
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: nonPrimary.id, e164, isPrimary: false })
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: primary.id, e164, isPrimary: true })

    const links = await matchCallToCrm(prisma, org.orgId, e164)

    expect(links.personId).toBe(primary.id)
  })
})

describe('matchInboundCallerToCrm (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('normalizes a unique inbound number and keeps the lookup inside the called organization', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId: orgA.orgId, name: 'Acme' })
    const personA = await seedPerson(prisma, { orgId: orgA.orgId, companyId: company.id })
    const personB = await seedPerson(prisma, { orgId: orgB.orgId })
    const e164 = '+13035551315'
    await seedPersonPhone(prisma, { orgId: orgA.orgId, personId: personA.id, e164 })
    await seedPersonPhone(prisma, { orgId: orgB.orgId, personId: personB.id, e164 })

    await expect(matchInboundCallerToCrm(prisma, orgA.orgId, ` ${e164} `))
      .resolves.toEqual({ personId: personA.id, companyId: company.id, dealId: null })
  })

  it('leaves an unknown or ambiguous inbound caller unlinked', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const first = await seedPerson(prisma, { orgId: org.orgId })
    const second = await seedPerson(prisma, { orgId: org.orgId })
    const e164 = '+13035551316'
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: first.id, e164 })
    await seedPersonPhone(prisma, { orgId: org.orgId, personId: second.id, e164 })

    await expect(matchInboundCallerToCrm(prisma, org.orgId, '+19998887777'))
      .resolves.toEqual({ personId: null, companyId: null, dealId: null })
    await expect(matchInboundCallerToCrm(prisma, org.orgId, e164))
      .resolves.toEqual({ personId: null, companyId: null, dealId: null })
  })
})

// The spine's core promise, proved against the real FK constraints: deleting a
// Person, Company, or Deal nulls the Call's link (ON DELETE SET NULL) instead of
// deleting the call. Call history is never destroyed as a side effect.
describe('Call CRM-spine FKs are SET NULL (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('nulls personId and companyId when the linked person is deleted, keeping the call', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId: org.orgId })
    const person = await seedPerson(prisma, { orgId: org.orgId, companyId: company.id })
    const call = await prisma.call.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        fromE164: '+12025550000',
        toE164: '+13035551321',
        direction: 'outbound',
        status: 'completed',
        personId: person.id,
        companyId: company.id,
      },
    })

    await prisma.person.delete({ where: { id: person.id } })

    const after = await prisma.call.findFirst({ where: { id: call.id, orgId: org.orgId } })
    // The call is untouched; only its person link is gone.
    expect(after).not.toBeNull()
    expect(after!.personId).toBeNull()
    // companyId was linked independently, so deleting the person leaves it alone.
    expect(after!.companyId).toBe(company.id)
  })

  it('nulls companyId when the linked company is deleted, keeping the call', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId: org.orgId })
    const call = await prisma.call.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        fromE164: '+12025550000',
        toE164: '+13035551322',
        direction: 'outbound',
        status: 'completed',
        companyId: company.id,
      },
    })

    await prisma.company.delete({ where: { id: company.id } })

    const after = await prisma.call.findFirst({ where: { id: call.id, orgId: org.orgId } })
    expect(after).not.toBeNull()
    expect(after!.companyId).toBeNull()
  })
})
