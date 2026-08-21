// The PrismaClient and seed helpers for the integration suite.
//
// This client is aimed at the per-run schema globalSetup created (its URL arrives
// through vitest's provide/inject). It is SEPARATE from the app's db.ts
// singleton, so a test can hand it to a service that accepts an injected client
// and never touch the global connection.
import { PrismaPg } from '@prisma/adapter-pg'
import { inject } from 'vitest'

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
 */
export async function seedOrgWithAdmin(
  prisma: PrismaClient,
  opts: { orgName?: string } = {},
): Promise<SeededOrg> {
  const suffix = uid()
  const orgName = opts.orgName ?? `Test Org ${suffix}`

  const org = await prisma.org.create({ data: { name: orgName } })
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
