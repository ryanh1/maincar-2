// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite proves the helper ASKS for the right rows. Only a real transaction
// can prove the claim the whole design rests on (spec §5.7, MAI-136 T8):
//
//   - a field change and its FieldHistory rows commit TOGETHER, and a rolled-back
//     write leaves NO history row behind;
//   - a change, then its history, reads back with the right old/new values;
//   - a system change stores changeSource="system" with a NULL user;
//   - the current value is still a plain column read — never replayed from history;
//   - Provenance exists as the trust seam, with its documented defaults.
//
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { diffFieldValues, recordFieldHistoryInTx } from '../fieldHistory.js'

describe('FieldHistory + Provenance (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function makePerson(orgId: string, title: string | null = 'SDR'): Promise<string> {
    const person = await prisma.person.create({
      data: { orgId, firstName: 'Jane', lastName: 'Doe', title },
    })
    return person.id
  }

  function historyFor(orgId: string, personId: string) {
    return prisma.fieldHistory.findMany({
      where: { orgId, objectSlug: 'person', recordId: personId },
      orderBy: { changedAt: 'asc' },
    })
  }

  // The write both other tests are about: a title change and its history, in ONE
  // transaction. `fail` makes the transaction throw AFTER both writes, which is the
  // only honest way to prove atomicity.
  async function changeTitle(
    orgId: string,
    personId: string,
    nextTitle: string,
    opts: { userId?: string | null; changeSource?: 'user' | 'system'; fail?: boolean } = {},
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.person.findFirst({ where: { id: personId, orgId } })
      const data = { title: nextTitle }
      const updated = await tx.person.updateMany({ where: { id: personId, orgId }, data })
      expect(updated.count).toBe(1)

      await recordFieldHistoryInTx(tx, {
        orgId,
        objectSlug: 'person',
        recordId: personId,
        changes: diffFieldValues(before as unknown as Record<string, unknown>, data),
        changeSource: opts.changeSource ?? 'user',
        changedByUserId: opts.userId ?? null,
        attributes: [{ slug: 'title', name: 'Title', type: 'text' }],
      })

      if (opts.fail) throw new Error('boom — the caller failed after both writes')
    })
  }

  it('writes a history row in the same transaction as the field change', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    await changeTitle(org.orgId, personId, 'Account Executive', { userId: org.adminUserId })

    const rows = await historyFor(org.orgId, personId)
    expect(rows).toHaveLength(1)
    expect(rows[0].attribute).toBe('title')
    expect(rows[0].oldJson).toBe('SDR')
    expect(rows[0].newJson).toBe('Account Executive')
    expect(rows[0].changeSource).toBe('user')
    expect(rows[0].changedByUserId).toBe(org.adminUserId)

    // The current value is a plain column read, not a replay of history (§5.7).
    const person = await prisma.person.findFirst({ where: { id: personId, orgId: org.orgId } })
    expect(person!.title).toBe('Account Executive')
  })

  it('leaves NO history row behind when the write is rolled back', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    await expect(
      changeTitle(org.orgId, personId, 'Never Committed', { userId: org.adminUserId, fail: true }),
    ).rejects.toThrow('boom')

    // Both halves rolled back together: no history row, and the old value stands.
    expect(await historyFor(org.orgId, personId)).toHaveLength(0)
    const person = await prisma.person.findFirst({ where: { id: personId, orgId: org.orgId } })
    expect(person!.title).toBe('SDR')
  })

  it('records a system change with changeSource=system and a null user', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    await changeTitle(org.orgId, personId, 'Enriched Title', {
      changeSource: 'system',
      // Offered but ignored: only a human edit names a human.
      userId: org.adminUserId,
    })

    const rows = await historyFor(org.orgId, personId)
    expect(rows).toHaveLength(1)
    expect(rows[0].changeSource).toBe('system')
    expect(rows[0].changedByUserId).toBeNull()
  })

  it('reads a field’s history back in order, oldest first', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    await changeTitle(org.orgId, personId, 'AE', { userId: org.adminUserId })
    await changeTitle(org.orgId, personId, 'Senior AE', { userId: org.adminUserId })

    const rows = await historyFor(org.orgId, personId)
    expect(rows.map((r) => [r.oldJson, r.newJson])).toEqual([
      ['SDR', 'AE'],
      ['AE', 'Senior AE'],
    ])
  })

  it('scopes history to its org', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(a.orgId)

    await changeTitle(a.orgId, personId, 'AE', { userId: a.adminUserId })

    expect(await historyFor(a.orgId, personId)).toHaveLength(1)
    expect(await historyFor(b.orgId, personId)).toHaveLength(0)
  })

  it('stores a Provenance row with its documented defaults', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    const row = await prisma.provenance.create({
      data: {
        orgId: org.orgId,
        objectSlug: 'person',
        recordId: personId,
        attribute: 'title',
        value: 'Account Executive',
        previousValue: 'SDR',
        source: 'enrichment_provider',
        sourceRef: { provider: 'acme-enrich' },
        evidenceSnippet: 'Jane Doe, Account Executive at Acme',
        confidence: 0.82,
      },
    })

    expect(row.status).toBe('unverified')
    expect(row.statusBy).toBeNull()
    expect(row.statusAt).toBeNull()
    expect(row.confidence).toBeCloseTo(0.82)
    expect(row.sourceRef).toEqual({ provider: 'acme-enrich' })
  })

  it('cascades both tables away with the org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const personId = await makePerson(org.orgId)

    await changeTitle(org.orgId, personId, 'AE', { userId: org.adminUserId })
    await prisma.provenance.create({
      data: {
        orgId: org.orgId,
        objectSlug: 'person',
        recordId: personId,
        attribute: 'title',
        source: 'ai_field',
      },
    })

    await prisma.org.delete({ where: { id: org.orgId } })

    expect(await prisma.fieldHistory.count({ where: { orgId: org.orgId } })).toBe(0)
    expect(await prisma.provenance.count({ where: { orgId: org.orgId } })).toBe(0)
  })
})
