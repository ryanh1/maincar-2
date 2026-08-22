// Real Postgres coverage for the lifecycle clauses used by the greeting route.
// Unit tests assert the route sends these clauses; this suite proves they keep
// tenant state isolated and preserve the old active greeting until promotion.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

function candidateData(orgId: string, idempotencyKey: string, status: string) {
  return {
    orgId,
    sourceKey: `uploads/${orgId}/${idempotencyKey}.webm`,
    storageKey: status === 'ready' || status === 'active'
      ? `greetings/${orgId}/${idempotencyKey}.mp3`
      : null,
    idempotencyKey,
    contentHash: `sha256:${idempotencyKey}`,
    status,
  }
}

async function promoteReadyGreeting(prisma: PrismaClient, orgId: string, greetingId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.voicemailGreeting.updateMany({
      where: { orgId, status: 'active', id: { not: greetingId } },
      data: { status: 'deleted', deletedAt: new Date() },
    })

    const promoted = await tx.voicemailGreeting.updateMany({
      where: { id: greetingId, orgId, status: 'ready' },
      data: { status: 'active' },
    })
    if (promoted.count === 0) throw new Error('Greeting is not ready to activate.')
    return true
  })
}

describe('Voicemail greeting lifecycle (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('keeps the active greeting until a ready replacement is explicitly promoted', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const oldGreeting = await prisma.voicemailGreeting.create({
      data: candidateData(org.orgId, 'old', 'active'),
    })
    const replacement = await prisma.voicemailGreeting.create({
      data: candidateData(org.orgId, 'replacement', 'ready'),
    })

    expect(await promoteReadyGreeting(prisma, org.orgId, replacement.id)).toBe(true)

    const greetings = await prisma.voicemailGreeting.findMany({
      where: { orgId: org.orgId },
      orderBy: { id: 'asc' },
    })
    expect(greetings.find((greeting) => greeting.id === oldGreeting.id)?.status).toBe('deleted')
    expect(greetings.find((greeting) => greeting.id === replacement.id)?.status).toBe('active')
  })

  it('rolls back instead of retiring the active greeting when a candidate is not ready', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const oldGreeting = await prisma.voicemailGreeting.create({
      data: candidateData(org.orgId, 'still-active', 'active'),
    })
    const failedCandidate = await prisma.voicemailGreeting.create({
      data: candidateData(org.orgId, 'failed-candidate', 'failed'),
    })

    await expect(promoteReadyGreeting(prisma, org.orgId, failedCandidate.id)).rejects.toThrow(
      'Greeting is not ready to activate.',
    )

    expect((await prisma.voicemailGreeting.findFirst({ where: { id: oldGreeting.id } }))?.status)
      .toBe('active')
  })

  it('does not promote, read, or delete another organization’s candidate', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const theirGreeting = await prisma.voicemailGreeting.create({
      data: candidateData(orgB.orgId, 'belongs-to-b', 'ready'),
    })

    await expect(promoteReadyGreeting(prisma, orgA.orgId, theirGreeting.id)).rejects.toThrow(
      'Greeting is not ready to activate.',
    )

    const visibleToA = await prisma.voicemailGreeting.findMany({
      where: { orgId: orgA.orgId, status: { not: 'deleted' } },
    })
    expect(visibleToA).toHaveLength(0)

    const deleted = await prisma.voicemailGreeting.updateMany({
      where: { id: theirGreeting.id, orgId: orgA.orgId, status: { not: 'deleted' } },
      data: { status: 'deleted', deletedAt: new Date() },
    })
    expect(deleted.count).toBe(0)
    expect((await prisma.voicemailGreeting.findFirst({ where: { id: theirGreeting.id } }))?.status).toBe('ready')
  })

  it('enforces one idempotency key per organization while allowing independent tenant retries', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await prisma.voicemailGreeting.create({
      data: candidateData(orgA.orgId, 'retry-key', 'transcoding'),
    })

    await expect(prisma.voicemailGreeting.create({
      data: candidateData(orgA.orgId, 'retry-key', 'transcoding'),
    })).rejects.toMatchObject({ code: 'P2002' })

    await expect(prisma.voicemailGreeting.create({
      data: candidateData(orgB.orgId, 'retry-key', 'transcoding'),
    })).resolves.toMatchObject({ orgId: orgB.orgId, idempotencyKey: 'retry-key' })
  })
})
