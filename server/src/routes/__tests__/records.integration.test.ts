// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suites mock Prisma and the GIN helper. This proves the things only real
// row state, real JSONB, and the real index can (MAI-135, T7 acceptance criteria):
//   - a user-defined object stores and reads back typed values;
//   - the GIN-indexed containment filter (@>) returns the right rows AND actually
//     uses the jsonb_path_ops GIN index (proven with EXPLAIN);
//   - a reference into a custom object resolves through a RecordLink;
//   - the uniqueness check (the same containment path the route uses) finds a
//     duplicate across rows.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { Prisma } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { filterRecordsByContainment, type RecordRow } from '../../crm/recordFilter.js'
import { validateRecordValues, type ValidatorAttribute } from '../../crm/valuesValidator.js'

describe('Record + RecordLink (integration, real Postgres)', () => {
  let prisma: PrismaClient
  // The isolated schema globalSetup created. Prisma qualifies its GENERATED queries
  // with it automatically, but a raw query (the @> containment filter) follows the
  // connection's search_path, which the pg adapter leaves at the default `public`.
  // So every transaction that runs the raw filter first points search_path at this
  // schema. In production db.ts uses `public`, where the route needs no such SET.
  let testSchema: string

  beforeAll(() => {
    prisma = createTestPrisma()
    testSchema = inject('testSchema')
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // Run the raw containment filter with the isolated schema on the search_path.
  async function filterInSchema(args: {
    orgId: string
    objectId: string
    match: Record<string, unknown>
  }): Promise<RecordRow[]> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}", public`)
      return filterRecordsByContainment(tx, args)
    })
  }

  // A custom (record-backed) object with a handful of typed fields.
  async function seedProjectObject(orgId: string): Promise<string> {
    const obj = await prisma.objectDef.create({
      data: { orgId, slug: `project_${Date.now()}`, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    await prisma.attributeDef.createMany({
      data: [
        { orgId, objectId: obj.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom', isRequired: true, sortOrder: 0 },
        { orgId, objectId: obj.id, slug: 'status', name: 'Status', type: 'select', storage: 'custom', sortOrder: 1,
          optionsJson: [{ value: 'active', label: 'Active', isArchived: false }, { value: 'done', label: 'Done', isArchived: false }] as unknown as Prisma.InputJsonValue },
        { orgId, objectId: obj.id, slug: 'budget', name: 'Budget', type: 'number', storage: 'custom', sortOrder: 2 },
        { orgId, objectId: obj.id, slug: 'sku', name: 'SKU', type: 'text', storage: 'custom', isUnique: true, sortOrder: 3 },
      ],
    })
    return obj.id
  }

  it('stores and reads back typed values on a user-defined object', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const objectId = await seedProjectObject(orgId)

    // Validate through the ONE validator, then persist — the app's real write path.
    const attributes = await prisma.attributeDef.findMany({ where: { orgId, objectId } })
    const valAttrs: ValidatorAttribute[] = attributes.map((a) => ({
      slug: a.slug, name: a.name, type: a.type, isRequired: a.isRequired, isUnique: a.isUnique,
      isMulti: a.isMulti, isReadOnly: a.isReadOnly, optionsJson: a.optionsJson ?? undefined,
    }))
    const result = await validateRecordValues({
      attributes: valAttrs, mode: 'create', input: { name: '  Launch  ', status: 'active', budget: 1200 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const created = await prisma.record.create({
      data: { orgId, objectId, valuesJson: result.values as Prisma.InputJsonValue },
    })
    const read = await prisma.record.findFirstOrThrow({ where: { id: created.id, orgId } })
    // Whitespace trimmed, types preserved through JSONB.
    expect(read.valuesJson).toEqual({ name: 'Launch', status: 'active', budget: 1200 })
  })

  it('filters records through the GIN containment path (@>)', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const objectId = await seedProjectObject(orgId)

    await prisma.record.create({ data: { orgId, objectId, valuesJson: { name: 'A', status: 'active' } } })
    await prisma.record.create({ data: { orgId, objectId, valuesJson: { name: 'B', status: 'active' } } })
    await prisma.record.create({ data: { orgId, objectId, valuesJson: { name: 'C', status: 'done' } } })

    const active = await filterInSchema({ orgId, objectId, match: { status: 'active' } })
    const done = await filterInSchema({ orgId, objectId, match: { status: 'done' } })

    expect(active.map((r) => (r.valuesJson as { name: string }).name).sort()).toEqual(['A', 'B'])
    expect(done).toHaveLength(1)
    expect((done[0].valuesJson as { name: string }).name).toBe('C')
  })

  it('the containment filter actually uses the jsonb_path_ops GIN index', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const objectId = await seedProjectObject(orgId)

    // Enough rows that the planner has a real choice to make.
    await prisma.record.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        orgId, objectId, valuesJson: { name: `P${i}`, status: i % 3 === 0 ? 'active' : 'done' },
      })),
    })

    // One connection for the whole check (SET LOCAL is transaction-scoped, and it
    // is also what puts the isolated schema on the search_path for raw SQL), with
    // seqscan forced off so a tiny table cannot mask whether the index is USABLE.
    // The predicate is the bare containment (@>) so the ONLY index that can serve
    // it is the jsonb_path_ops GIN one — proving that index, specifically, is used.
    const planText = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}", public`)
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
      const rows = await tx.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`
        EXPLAIN (FORMAT JSON)
        SELECT "id" FROM "Record"
        WHERE "valuesJson" @> ${'{"status":"active"}'}::jsonb
      `)
      return JSON.stringify(rows)
    })

    // The GIN index is reached via a Bitmap Index Scan; both facts prove it is used.
    expect(planText).toContain('Record_valuesJson_idx')
    expect(planText).toContain('Bitmap Index Scan')
  })

  it('resolves a reference into another custom object via RecordLink', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const projectId = await seedProjectObject(orgId)

    // A second custom object to point AT.
    const client = await prisma.objectDef.create({
      data: { orgId, slug: `client_${Date.now()}`, name: 'Client', namePlural: 'Clients', storage: 'record', isStandard: false },
    })
    const target = await prisma.record.create({
      data: { orgId, objectId: client.id, valuesJson: { name: 'Globex' } },
    })

    // A project record that references the client, mirrored as a RecordLink edge.
    const project = await prisma.record.create({
      data: { orgId, objectId: projectId, valuesJson: { name: 'Migration', client: target.id } },
    })
    await prisma.recordLink.create({
      data: { orgId, fromObject: 'record', fromId: project.id, attribute: 'client', toObject: client.slug, toId: target.id },
    })

    // Resolve: read the link, then load the target it points at.
    const links = await prisma.recordLink.findMany({ where: { orgId, fromObject: 'record', fromId: project.id } })
    expect(links).toHaveLength(1)
    const resolved = await prisma.record.findFirstOrThrow({ where: { id: links[0].toId, orgId } })
    expect((resolved.valuesJson as { name: string }).name).toBe('Globex')
  })

  it('the uniqueness path finds a duplicate value across rows', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const objectId = await seedProjectObject(orgId)

    await prisma.record.create({ data: { orgId, objectId, valuesJson: { name: 'One', sku: 'A-1' } } })

    // The same containment query the route's uniqueness checker runs.
    const clash = await filterInSchema({ orgId, objectId, match: { sku: 'A-1' } })
    const free = await filterInSchema({ orgId, objectId, match: { sku: 'A-2' } })
    expect(clash).toHaveLength(1)
    expect(free).toHaveLength(0)
  })

  it('keeps the tenant boundary: another org never matches the filter', async () => {
    const { orgId: orgA } = await seedOrgWithAdmin(prisma)
    const { orgId: orgB } = await seedOrgWithAdmin(prisma)
    const objectA = await seedProjectObject(orgA)

    await prisma.record.create({ data: { orgId: orgA, objectId: objectA, valuesJson: { name: 'A', status: 'active' } } })

    // Same objectId, wrong org — the orgId predicate in the raw query holds.
    const leaked = await filterInSchema({ orgId: orgB, objectId: objectA, match: { status: 'active' } })
    expect(leaked).toHaveLength(0)
  })
})
