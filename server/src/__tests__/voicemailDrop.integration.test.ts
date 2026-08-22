// The unit suite above proves the written schema. This integration suite proves
// the migration created a real partial unique index, which is the part Prisma's
// schema DSL cannot express: an org may have many drops, but just one default.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

describe('VoicemailDrop (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores a reusable drop and its pending transcript metadata', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    const drop = await prisma.voicemailDrop.create({
      data: {
        orgId,
        name: 'First touch follow-up',
        audioUrl: `maincar-voicemail-drops/${orgId}/first-touch.mp3`,
        duration: 23,
      },
    })

    expect(drop.name).toBe('First touch follow-up')
    expect(drop.duration).toBe(23)
    expect(drop.isDefault).toBe(false)
    expect(drop.transcript).toBeNull()
    expect(drop.transcriptStatus).toBe('pending')
  })

  it('allows non-default drops alongside one default, but rejects a second default in the same org', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const base = { orgId, audioUrl: `maincar-voicemail-drops/${orgId}/drop.mp3`, duration: 18 }

    await prisma.voicemailDrop.create({ data: { ...base, name: 'Default', isDefault: true } })
    await prisma.voicemailDrop.create({ data: { ...base, name: 'Alternative', isDefault: false } })

    await expect(
      prisma.voicemailDrop.create({ data: { ...base, name: 'Second default', isDefault: true } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('allows each organization to choose its own default drop', async () => {
    const first = await seedOrgWithAdmin(prisma)
    const second = await seedOrgWithAdmin(prisma)

    await prisma.voicemailDrop.create({
      data: { orgId: first.orgId, name: 'First org default', audioUrl: 'drops/first.mp3', duration: 10, isDefault: true },
    })
    await prisma.voicemailDrop.create({
      data: { orgId: second.orgId, name: 'Second org default', audioUrl: 'drops/second.mp3', duration: 12, isDefault: true },
    })

    expect(
      await prisma.voicemailDrop.count({
        where: { orgId: { in: [first.orgId, second.orgId] }, isDefault: true },
      }),
    ).toBe(2)
  })

  it('cascades a drop when its organization is deleted', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const drop = await prisma.voicemailDrop.create({
      data: { orgId, name: 'Temporary', audioUrl: 'drops/temporary.mp3', duration: 15 },
    })

    await prisma.org.delete({ where: { id: orgId } })

    expect(await prisma.voicemailDrop.findUnique({ where: { id: drop.id } })).toBeNull()
  })
})
