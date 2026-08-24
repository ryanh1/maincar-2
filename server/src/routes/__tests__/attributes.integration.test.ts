// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma. This proves the value-rename migration actually
// rewrites rows across the attribute's real storage (MAI-351 acceptance):
//   - countOptionValue returns the number of records holding a value;
//   - migrateOptionValue moves every record from the old value to the new one,
//     for both a record-backed custom field (valuesJson) and a typed column
//     (Company.companyType).
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { Prisma } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import {
  collapseMultiValueRows,
  countOptionValue,
  lockMultiValueRows,
  migrateOptionValue,
} from '../../crm/attributeValueMigrations.js'

describe('attribute value migrations (integration, real Postgres)', () => {
  let prisma: PrismaClient
  let testSchema: string

  beforeAll(() => {
    prisma = createTestPrisma()
    testSchema = inject('testSchema')
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // Raw SQL follows the connection's search_path, which the pg adapter leaves at
  // `public`; point it at the isolated schema first (see records.integration.test.ts).
  async function migrateInSchema(args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    oldValue: string
    newValue: string
  }): Promise<number> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}", public`)
      return migrateOptionValue(tx, args)
    })
  }

  async function countInSchema(args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    value: string
  }): Promise<number> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}", public`)
      return countOptionValue(tx, args)
    })
  }

  async function collapseInSchema(args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string }
  }): Promise<{ recordCount: number; collapsed: number }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}", public`)
      const rows = await lockMultiValueRows(tx, args)
      const recordCount = rows.filter((row) => Array.isArray(row.value) && row.value.length > 1).length
      const collapsed = await collapseMultiValueRows(tx, args)
      return { recordCount, collapsed }
    })
  }

  it('counts risky arrays and keeps the first value for a record-backed custom field', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const object = await prisma.objectDef.create({
      data: { orgId, slug: `project_refs_${Date.now()}`, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    const otherObject = await prisma.objectDef.create({
      data: { orgId, slug: `other_refs_${Date.now()}`, name: 'Other', namePlural: 'Others', storage: 'record', isStandard: false },
    })
    const records = await Promise.all([
      prisma.record.create({ data: { orgId, objectId: object.id, valuesJson: { companies: ['company-1', 'company-2'] } } }),
      prisma.record.create({ data: { orgId, objectId: object.id, valuesJson: { companies: ['company-3'] } } }),
      prisma.record.create({ data: { orgId, objectId: object.id, valuesJson: { companies: [] } } }),
      prisma.record.create({ data: { orgId, objectId: object.id, valuesJson: { companies: 'legacy-scalar' } } }),
      prisma.record.create({ data: { orgId, objectId: otherObject.id, valuesJson: { companies: ['other-1', 'other-2'] } } }),
    ])
    const args = {
      orgId,
      object: { id: object.id, slug: object.slug, storage: object.storage },
      attribute: { slug: 'companies', storage: 'custom' },
    }

    await expect(collapseInSchema(args)).resolves.toEqual({ recordCount: 1, collapsed: 3 })

    const updated = await prisma.record.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } })
    expect((updated.find((row) => row.id === records[0].id)!.valuesJson as { companies: string }).companies).toBe('company-1')
    expect((updated.find((row) => row.id === records[1].id)!.valuesJson as { companies: string }).companies).toBe('company-3')
    expect(updated.find((row) => row.id === records[2].id)!.valuesJson).toEqual({})
    expect((updated.find((row) => row.id === records[3].id)!.valuesJson as { companies: string }).companies).toBe('legacy-scalar')
    expect((updated.find((row) => row.id === records[4].id)!.valuesJson as { companies: string[] }).companies).toEqual(['other-1', 'other-2'])
  })

  it('collapses only live rows in the owning org for a table-backed custom field', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma, { seed: true })
    const companyObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'company' } })
    const companies = await Promise.all([
      prisma.company.create({ data: { orgId, name: 'Acme', customJson: { contacts: ['person-1', 'person-2'] } } }),
      prisma.company.create({ data: { orgId, name: 'Globex', customJson: { contacts: ['person-3'] } } }),
      prisma.company.create({ data: { orgId, name: 'Deleted', customJson: { contacts: ['person-4', 'person-5'] }, deletedAt: new Date() } }),
    ])
    const args = {
      orgId,
      object: { id: companyObject.id, slug: companyObject.slug, storage: companyObject.storage },
      attribute: { slug: 'contacts', storage: 'custom' },
    }

    await expect(collapseInSchema(args)).resolves.toEqual({ recordCount: 1, collapsed: 2 })

    const updated = await prisma.company.findMany({ where: { orgId } })
    expect((updated.find((row) => row.id === companies[0].id)!.customJson as { contacts: string }).contacts).toBe('person-1')
    expect((updated.find((row) => row.id === companies[1].id)!.customJson as { contacts: string }).contacts).toBe('person-3')
    expect((updated.find((row) => row.id === companies[2].id)!.customJson as { contacts: string[] }).contacts).toEqual(['person-4', 'person-5'])
  })

  it('migrates a record-backed custom field value across valuesJson', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    const object = await prisma.objectDef.create({
      data: { orgId, slug: `project_${Date.now()}`, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    await prisma.attributeDef.create({
      data: {
        orgId, objectId: object.id, slug: 'status', name: 'Status', type: 'select', storage: 'custom', sortOrder: 0,
        optionsJson: [{ value: 'active', label: 'Active' }, { value: 'done', label: 'Done' }] as unknown as Prisma.InputJsonValue,
      },
    })

    await prisma.record.createMany({
      data: [
        { orgId, objectId: object.id, valuesJson: { status: 'active' } },
        { orgId, objectId: object.id, valuesJson: { status: 'active' } },
        { orgId, objectId: object.id, valuesJson: { status: 'done' } },
      ],
    })

    const attribute = { slug: 'status', storage: 'custom' }
    const objectRef = { id: object.id, slug: object.slug, storage: object.storage }

    expect(await countInSchema({ orgId, object: objectRef, attribute, value: 'active' })).toBe(2)

    const migrated = await migrateInSchema({ orgId, object: objectRef, attribute, oldValue: 'active', newValue: 'live' })
    expect(migrated).toBe(2)

    const rows = await prisma.record.findMany({ where: { orgId, objectId: object.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((row) => (row.valuesJson as { status: string }).status).sort()).toEqual(['done', 'live', 'live'])
  })

  it('migrates a typed column value (Company.companyType)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma, { seed: true })

    const company = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'company' } })

    await prisma.company.createMany({
      data: [
        { orgId, name: 'Acme', companyType: 'saas' },
        { orgId, name: 'Globex', companyType: 'saas' },
        { orgId, name: 'Initech', companyType: 'agency' },
      ],
    })

    const attribute = { slug: 'companyType', storage: 'column' }
    const objectRef = { id: company.id, slug: company.slug, storage: company.storage }

    expect(await countInSchema({ orgId, object: objectRef, attribute, value: 'saas' })).toBe(2)

    const migrated = await migrateInSchema({ orgId, object: objectRef, attribute, oldValue: 'saas', newValue: 'software' })
    expect(migrated).toBe(2)

    const companies = await prisma.company.findMany({ where: { orgId }, orderBy: { name: 'asc' } })
    expect(companies.map((row) => row.companyType).sort()).toEqual(['agency', 'software', 'software'])
  })

  it('migrates a multiselect value across record JSON arrays', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const object = await prisma.objectDef.create({
      data: { orgId, slug: `project_tags_${Date.now()}`, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    await prisma.record.createMany({
      data: [
        { orgId, objectId: object.id, valuesJson: { tags: ['active', 'priority'] } },
        { orgId, objectId: object.id, valuesJson: { tags: ['active'] } },
        { orgId, objectId: object.id, valuesJson: { tags: ['done'] } },
      ],
    })

    const attribute = { slug: 'tags', storage: 'custom', isMulti: true }
    const objectRef = { id: object.id, slug: object.slug, storage: object.storage }

    expect(await countInSchema({ orgId, object: objectRef, attribute, value: 'active' })).toBe(2)
    expect(await migrateInSchema({ orgId, object: objectRef, attribute, oldValue: 'active', newValue: 'live' })).toBe(2)

    const rows = await prisma.record.findMany({ where: { orgId, objectId: object.id } })
    expect(rows.map((row) => (row.valuesJson as { tags: string[] }).tags.join(',')).sort()).toEqual(['done', 'live', 'live,priority'])
  })

  it('migrates a list-scoped option value without touching another object\'s entries', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma, { seed: true })
    const person = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'person' } })
    const list = await prisma.list.create({ data: { orgId, name: 'Q3 outreach', slug: `q3-outreach-${Date.now()}`, objectSlug: 'person' } })
    const otherList = await prisma.list.create({ data: { orgId, name: 'Other outreach', slug: `other-outreach-${Date.now()}`, objectSlug: 'company' } })
    await prisma.listEntry.createMany({
      data: [
        { orgId, listId: list.id, objectSlug: 'person', targetId: 'person-1', valuesJson: { stage: 'open' } },
        { orgId, listId: list.id, objectSlug: 'person', targetId: 'person-2', valuesJson: { stage: 'open' } },
        { orgId, listId: otherList.id, objectSlug: 'company', targetId: 'company-1', valuesJson: { stage: 'open' } },
      ],
    })

    const attribute = { slug: 'stage', storage: 'list', isMulti: false }
    const objectRef = { id: person.id, slug: person.slug, storage: person.storage }

    expect(await countInSchema({ orgId, object: objectRef, attribute, value: 'open' })).toBe(2)
    expect(await migrateInSchema({ orgId, object: objectRef, attribute, oldValue: 'open', newValue: 'contacted' })).toBe(2)

    const entries = await prisma.listEntry.findMany({ where: { orgId } })
    expect(entries.map((entry) => (entry.valuesJson as { stage: string }).stage).sort()).toEqual(['contacted', 'contacted', 'open'])
  })
})
