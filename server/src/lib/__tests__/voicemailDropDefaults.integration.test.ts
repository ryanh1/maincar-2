import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ensureOneDefault } from '../voicemailDropDefaults.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('ensureOneDefault (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('makes a newly inserted only drop the default', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await prisma.$transaction(async (tx) => {
      const drop = await tx.voicemailDrop.create({
        data: { orgId, name: 'Only drop', audioUrl: 'drops/only.mp3', duration: 15 },
      })
      await ensureOneDefault(tx, orgId, { fallbackDefaultId: drop.id })
    })

    const drops = await prisma.voicemailDrop.findMany({ where: { orgId } })
    expect(drops).toHaveLength(1)
    expect(drops[0]!.isDefault).toBe(true)
  })

  it('atomically transfers the default to a requested drop', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await prisma.voicemailDrop.create({
      data: { orgId, name: 'Current', audioUrl: 'drops/current.mp3', duration: 15, isDefault: true },
    })
    const next = await prisma.voicemailDrop.create({
      data: { orgId, name: 'Next', audioUrl: 'drops/next.mp3', duration: 15 },
    })

    await prisma.$transaction((tx) => ensureOneDefault(tx, orgId, { defaultId: next.id }))

    const defaults = await prisma.voicemailDrop.findMany({ where: { orgId, isDefault: true } })
    expect(defaults.map((drop) => drop.id)).toEqual([next.id])
  })

  it('promotes the oldest surviving drop after the default is deleted', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const oldest = await prisma.voicemailDrop.create({
      data: {
        orgId, name: 'Oldest', audioUrl: 'drops/oldest.mp3', duration: 15,
        createdAt: new Date('2026-08-20T12:00:00.000Z'),
      },
    })
    const defaultDrop = await prisma.voicemailDrop.create({
      data: {
        orgId, name: 'Default', audioUrl: 'drops/default.mp3', duration: 15, isDefault: true,
        createdAt: new Date('2026-08-22T12:00:00.000Z'),
      },
    })

    await prisma.$transaction(async (tx) => {
      await tx.voicemailDrop.deleteMany({ where: { id: defaultDrop.id, orgId } })
      await ensureOneDefault(tx, orgId)
    })

    const defaults = await prisma.voicemailDrop.findMany({ where: { orgId, isDefault: true } })
    expect(defaults.map((drop) => drop.id)).toEqual([oldest.id])
  })

  it('serializes simultaneous default changes so exactly one remains', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await prisma.voicemailDrop.create({
      data: { orgId, name: 'Current', audioUrl: 'drops/current.mp3', duration: 15, isDefault: true },
    })
    const left = await prisma.voicemailDrop.create({
      data: { orgId, name: 'Left', audioUrl: 'drops/left.mp3', duration: 15 },
    })
    const right = await prisma.voicemailDrop.create({
      data: { orgId, name: 'Right', audioUrl: 'drops/right.mp3', duration: 15 },
    })

    await Promise.all([
      prisma.$transaction((tx) => ensureOneDefault(tx, orgId, { defaultId: left.id })),
      prisma.$transaction((tx) => ensureOneDefault(tx, orgId, { defaultId: right.id })),
    ])

    expect(await prisma.voicemailDrop.count({ where: { orgId, isDefault: true } })).toBe(1)
  })
})
