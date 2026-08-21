// The PrismaClient and seed helpers for the integration suite.
//
// This client is aimed at the per-run schema globalSetup created (its URL arrives
// through vitest's provide/inject). It is SEPARATE from the app's db.ts
// singleton, so a test can hand it to a service that accepts an injected client
// and never touch the global connection.
import { PrismaPg } from '@prisma/adapter-pg'
import { inject } from 'vitest'

import { seedOrgInTx } from '../../crm/seedOrg.js'
import { PrismaClient } from '../../generated/prisma/client.js'

// Tell TypeScript what globalSetup provides.
declare module 'vitest' {
  interface ProvidedContext {
    testDatabaseUrl: string
    testSchema: string
  }
}

export function createTestPrisma(): PrismaClient {
  const connectionString = inject('testDatabaseUrl')
  const schema = inject('testSchema')
  // The adapter's `schema` option sets the search path, so every query lands in
  // the isolated schema.
  const adapter = new PrismaPg({ connectionString }, { schema })
  return new PrismaClient({ adapter })
}

/** A short unique suffix, so repeated seeds in one schema never collide. */
function uid(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`
}

export interface SeededOrg {
  orgId: string
  orgName: string
  adminUserId: string
  adminEmail: string
  adminFirebaseUid: string
  adminMembershipId: string
}

/**
 * Seeds an Org plus its first admin — the minimum an authenticated route needs.
 *
 * Multi-org: the user is joined to the org through a Membership, and the org is
 * set as their `currentOrgId`. The per-org role lives on the Membership.
 *
 * `seed: true` additionally runs the REAL standard-schema seed (seedOrgInTx, the
 * same code org creation runs), so the org has its ObjectDefs, AttributeDefs, and
 * the default pipeline — i.e. it is shaped like a production org. It is OPT-IN and
 * defaults to OFF: the bare org is what most route tests want, and seeding every
 * one of them would slow the whole suite down for no gain. Ask for it in a test
 * that reads or writes through the schema-as-data layer.
 */
export async function seedOrgWithAdmin(
  prisma: PrismaClient,
  opts: { orgName?: string; seed?: boolean } = {},
): Promise<SeededOrg> {
  const suffix = uid()
  const orgName = opts.orgName ?? `Test Org ${suffix}`

  const org = await prisma.org.create({ data: { name: orgName } })
  if (opts.seed) {
    await prisma.$transaction((tx) => seedOrgInTx(tx, org.id))
  }
  const admin = await prisma.user.create({
    data: {
      firebaseUid: `fb_${suffix}`,
      email: `admin_${suffix}@example.com`,
      firstName: 'Avery',
      lastName: 'Admin',
      roles: ['admin'],
      currentOrgId: org.id,
    },
  })
  const membership = await prisma.membership.create({
    data: { userId: admin.id, orgId: org.id, roles: ['admin'] },
  })

  return {
    orgId: org.id,
    orgName,
    adminUserId: admin.id,
    adminEmail: admin.email,
    adminFirebaseUid: admin.firebaseUid,
    adminMembershipId: membership.id,
  }
}

/** Adds an existing-style member user to an org with the given per-org roles. */
export async function seedMember(
  prisma: PrismaClient,
  orgId: string,
  opts: { roles?: string[] } = {},
): Promise<{ userId: string; email: string; firebaseUid: string; membershipId: string }> {
  const suffix = uid()
  const user = await prisma.user.create({
    data: {
      firebaseUid: `fb_member_${suffix}`,
      email: `member_${suffix}@example.com`,
      firstName: 'Morgan',
      lastName: 'Member',
      currentOrgId: orgId,
    },
  })
  const membership = await prisma.membership.create({
    data: { userId: user.id, orgId, roles: opts.roles ?? ['basic'] },
  })

  return {
    userId: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
    membershipId: membership.id,
  }
}

/**
 * Adds a phone number to an org, assigned to a user.
 *
 * `createdAt` is settable because the list route's tie-break sorts on it, and a
 * test cannot prove "oldest first" with rows written milliseconds apart.
 */
export async function seedPhoneNumber(
  prisma: PrismaClient,
  opts: {
    orgId: string
    assignedUserId: string
    e164?: string
    twilioSid?: string | null
    status?: string
    isActiveForOutbound?: boolean
    createdAt?: Date
  },
): Promise<{ id: string; e164: string }> {
  const suffix = uid()
  const number = await prisma.phoneNumber.create({
    data: {
      orgId: opts.orgId,
      assignedUserId: opts.assignedUserId,
      e164: opts.e164 ?? `+1202555${suffix.slice(-4)}`,
      twilioSid: opts.twilioSid === undefined ? `PN${suffix}` : opts.twilioSid,
      status: opts.status ?? 'active',
      isActiveForOutbound: opts.isActiveForOutbound ?? false,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
  return { id: number.id, e164: number.e164 }
}

/**
 * Adds a Company to an org (MAI-132 tests). Only the identity anchor is settable —
 * a name and/or domain — since that is all the number→person match needs to prove a
 * call rolls up to the right account.
 */
export async function seedCompany(
  prisma: PrismaClient,
  opts: { orgId: string; name?: string; domain?: string },
): Promise<{ id: string }> {
  const suffix = uid()
  const company = await prisma.company.create({
    data: {
      orgId: opts.orgId,
      name: opts.name ?? `Acme ${suffix}`,
      domain: opts.domain ?? null,
    },
  })
  return { id: company.id }
}

/**
 * Adds a Person to an org, optionally at a company (MAI-132 tests). companyId is
 * settable because the match rolls a matched person up to their company, and a test
 * cannot prove that without placing the person at one.
 */
export async function seedPerson(
  prisma: PrismaClient,
  opts: { orgId: string; companyId?: string | null; firstName?: string },
): Promise<{ id: string }> {
  const suffix = uid()
  const person = await prisma.person.create({
    data: {
      orgId: opts.orgId,
      firstName: opts.firstName ?? `Pat ${suffix}`,
      companyId: opts.companyId ?? null,
    },
  })
  return { id: person.id }
}

/**
 * Adds a dialable number to a person (MAI-132 tests). `e164` is the match key the
 * whole feature turns on, so it is required; `isPrimary` is settable so a test can
 * prove the match prefers a primary number when one number is held by two people.
 */
export async function seedPersonPhone(
  prisma: PrismaClient,
  opts: { orgId: string; personId: string; e164: string; isPrimary?: boolean },
): Promise<{ id: string }> {
  const phone = await prisma.personPhone.create({
    data: {
      orgId: opts.orgId,
      personId: opts.personId,
      e164: opts.e164,
      isPrimary: opts.isPrimary ?? false,
    },
  })
  return { id: phone.id }
}

/**
 * Adds a Call row, for the outbound-call routes' guards and lookups.
 *
 * `status` and `toE164` are settable because the double-call guard turns on both:
 * a test cannot prove "an in-flight call to this number blocks a second" without
 * choosing which status counts as in-flight and which destination it is to.
 */
export async function seedCall(
  prisma: PrismaClient,
  opts: {
    orgId: string
    userId: string
    fromE164?: string
    toE164?: string
    direction?: string
    status?: string
    recordingConsent?: string | null
    twilioCallSid?: string | null
  },
): Promise<{ id: string; toE164: string }> {
  const suffix = uid()
  const call = await prisma.call.create({
    data: {
      orgId: opts.orgId,
      userId: opts.userId,
      fromE164: opts.fromE164 ?? '+12025550000',
      toE164: opts.toE164 ?? `+1202556${suffix.slice(-4)}`,
      direction: opts.direction ?? 'outbound',
      status: opts.status ?? 'queued',
      recordingConsent: opts.recordingConsent ?? null,
      twilioCallSid: opts.twilioCallSid ?? null,
    },
  })
  return { id: call.id, toE164: call.toE164 }
}
