// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// seedOrg touches unique constraints, JSONB option lists, cross-row references,
// and a transaction — none of which the mocked unit suite can prove. This pins the
// MAI-134 (T6) acceptance criteria:
//   - a new org gets all standard objects, their fields, seeded picklist options,
//     and a default pipeline, and its seedVersion is stamped;
//   - running the seed twice is a no-op (idempotent) — no duplicate rows;
//   - the backfill inserts ONLY a missing standard field, and never overwrites a
//     renamed label or a user-added picklist option (insert-missing-only, §10.2);
//   - the seed runs inside a caller's transaction (the org-creation path).
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { seedOrg, seedOrgInTx } from '../seedOrg.js'
import {
  CURRENT_SEED_VERSION,
  DEFAULT_PIPELINE,
  STANDARD_DISPOSITIONS,
  STANDARD_OBJECTS,
} from '../standardObjects.js'

// Expected counts derived from the seed data itself, so they never drift from it.
const EXPECTED_OBJECT_COUNT = STANDARD_OBJECTS.length
const EXPECTED_ATTRIBUTE_COUNT = STANDARD_OBJECTS.reduce((n, o) => n + o.attributes.length, 0)

describe('seedOrg (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('seeds all standard objects, fields, options, a default pipeline, and stamps seedVersion', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    await seedOrg(orgId, prisma)

    // Objects
    const objects = await prisma.objectDef.findMany({ where: { orgId } })
    expect(objects).toHaveLength(EXPECTED_OBJECT_COUNT)
    expect(objects.every((o) => o.isStandard)).toBe(true)
    expect(objects.map((o) => o.slug).sort()).toEqual(
      STANDARD_OBJECTS.map((o) => o.slug).sort(),
    )

    // Attributes
    const attributes = await prisma.attributeDef.findMany({ where: { orgId } })
    expect(attributes).toHaveLength(EXPECTED_ATTRIBUTE_COUNT)

    const person = objects.find((o) => o.slug === 'person')!
    const company = objects.find((o) => o.slug === 'company')!
    const deal = objects.find((o) => o.slug === 'deal')!

    // A typed, system column field.
    const firstName = attributes.find((a) => a.objectId === person.id && a.slug === 'firstName')!
    expect(firstName.type).toBe('person_name')
    expect(firstName.storage).toBe('column')
    expect(firstName.isSystem).toBe(true)

    // A seeded CUSTOM field (a social) lands in customJson (storage "custom").
    const xUrl = attributes.find((a) => a.objectId === person.id && a.slug === 'x_url')!
    expect(xUrl.type).toBe('url')
    expect(xUrl.storage).toBe('custom')

    // A record_reference resolves refObjectId to the real target ObjectDef.
    const companyRef = attributes.find((a) => a.objectId === person.id && a.slug === 'companyId')!
    expect(companyRef.type).toBe('record_reference')
    expect(companyRef.refObjectId).toBe(company.id)

    // A seeded picklist carries its editable options.
    const companyType = attributes.find((a) => a.objectId === company.id && a.slug === 'companyType')!
    const options = companyType.optionsJson as Array<{ value: string }>
    expect(options.map((o) => o.value)).toContain('saas')

    // The reportable Deal segment is a system-owned custom select, so its slug
    // remains stable for server-side reporting even when its label is edited.
    const segment = attributes.find((a) => a.objectId === deal.id && a.slug === 'segment')!
    expect(segment).toMatchObject({ type: 'select', storage: 'custom', isSystem: true })

    // The default pipeline and its stages.
    const pipelines = await prisma.pipeline.findMany({ where: { orgId } })
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0].isDefault).toBe(true)
    const stages = await prisma.pipelineStage.findMany({ where: { orgId, pipelineId: pipelines[0].id } })
    expect(stages).toHaveLength(DEFAULT_PIPELINE.stages.length)
    expect(stages.find((s) => s.outcome === 'won')?.winProbability).toBe(100)

    const dispositions = await prisma.dispositionDef.findMany({ where: { orgId }, orderBy: { sortOrder: 'asc' } })
    expect(dispositions).toHaveLength(STANDARD_DISPOSITIONS.length)
    expect(dispositions.map((disposition) => disposition.value)).toEqual(STANDARD_DISPOSITIONS.map((disposition) => disposition.value))
    expect(dispositions.every((disposition) => disposition.isStandard)).toBe(true)
    expect(dispositions.map((disposition) => ({ isPinned: disposition.isPinned, pinOrder: disposition.pinOrder }))).toEqual(
      STANDARD_DISPOSITIONS.map((disposition) => ({ isPinned: disposition.isPinned, pinOrder: disposition.pinOrder })),
    )

    // seedVersion is stamped.
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } })
    expect(org.seedVersion).toBe(CURRENT_SEED_VERSION)
  })

  it('is idempotent — running the seed twice is a no-op (no duplicate rows)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    await seedOrg(orgId, prisma)
    const objectsBefore = await prisma.objectDef.findMany({ where: { orgId }, select: { id: true } })
    const attrsBefore = await prisma.attributeDef.count({ where: { orgId } })
    const stagesBefore = await prisma.pipelineStage.count({ where: { orgId } })

    await seedOrg(orgId, prisma)
    const objectsAfter = await prisma.objectDef.findMany({ where: { orgId }, select: { id: true } })
    const attrsAfter = await prisma.attributeDef.count({ where: { orgId } })
    const stagesAfter = await prisma.pipelineStage.count({ where: { orgId } })

    expect(objectsAfter).toHaveLength(EXPECTED_OBJECT_COUNT)
    expect(attrsAfter).toBe(attrsBefore)
    expect(stagesAfter).toBe(stagesBefore)
    // Same rows, not replaced ones.
    expect(objectsAfter.map((o) => o.id).sort()).toEqual(objectsBefore.map((o) => o.id).sort())
    await expect(prisma.pipeline.count({ where: { orgId } })).resolves.toBe(1)
  })

  it('backfill inserts ONLY a missing standard field, never overwriting a rename or a user-added option', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await seedOrg(orgId, prisma)

    const person = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'person' } })
    const company = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'company' } })

    // The user renames a standard object's label...
    await prisma.objectDef.update({ where: { id: person.id }, data: { name: 'Contact' } })

    // ...adds their own option to a picklist and recolors an existing one...
    const companyType = await prisma.attributeDef.findFirstOrThrow({
      where: { objectId: company.id, slug: 'companyType' },
    })
    const editedOptions = [
      ...(companyType.optionsJson as Array<{ value: string; label: string; color: string; order: number; isArchived: boolean }>).map(
        (o) => (o.value === 'saas' ? { ...o, color: '#000000' } : o),
      ),
      { value: 'government', label: 'Government', color: '#111827', order: 99, isArchived: false },
    ]
    await prisma.attributeDef.update({ where: { id: companyType.id }, data: { optionsJson: editedOptions } })

    // ...and a standard field goes missing (simulating a NEW field added to a later
    // seed version: after backfill it must be present again).
    const title = await prisma.attributeDef.findFirstOrThrow({
      where: { objectId: person.id, slug: 'title' },
    })
    await prisma.attributeDef.delete({ where: { id: title.id } })

    // Backfill.
    await seedOrg(orgId, prisma)

    // The missing standard field is re-inserted.
    const titleAfter = await prisma.attributeDef.findFirst({
      where: { objectId: person.id, slug: 'title' },
    })
    expect(titleAfter).not.toBeNull()

    // The renamed label survived — backfill never overwrites it.
    const personAfter = await prisma.objectDef.findUniqueOrThrow({ where: { id: person.id } })
    expect(personAfter.name).toBe('Contact')

    // The user-added option AND the recolor survived.
    const companyTypeAfter = await prisma.attributeDef.findUniqueOrThrow({ where: { id: companyType.id } })
    const optionsAfter = companyTypeAfter.optionsJson as Array<{ value: string; color: string }>
    expect(optionsAfter.find((o) => o.value === 'government')).toBeTruthy()
    expect(optionsAfter.find((o) => o.value === 'saas')?.color).toBe('#000000')

    // No object/attribute was duplicated.
    await expect(prisma.objectDef.count({ where: { orgId } })).resolves.toBe(EXPECTED_OBJECT_COUNT)
    await expect(prisma.attributeDef.count({ where: { orgId } })).resolves.toBe(EXPECTED_ATTRIBUTE_COUNT)
  })

  it('runs inside a caller-supplied transaction (the org-creation path)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    // Mirrors routes/team.ts: the seed runs in the SAME transaction as org creation.
    await prisma.$transaction((tx) => seedOrgInTx(tx, orgId))

    await expect(prisma.objectDef.count({ where: { orgId } })).resolves.toBe(EXPECTED_OBJECT_COUNT)
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } })
    expect(org.seedVersion).toBe(CURRENT_SEED_VERSION)
  })
})
