// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma and proves the route wiring. This proves the T13
// acceptance criteria themselves, which only real rows and real constraints can:
//   - a task links to a person, a company, AND a deal — through the EXISTING
//     RecordLink table, not a parallel link table;
//   - a calendar-derived task is distinguishable from a hand-made one via
//     `origin`, including one that carries an eventId and is still manual;
//   - the link rows are real foreign keys, so deleting a task takes them with it
//     while deleting the RECORD it points at does not delete the task;
//   - org isolation holds on the table and on its links.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { idsLinkedToRecord, syncWorkLinks, verifyLinkTargets } from '../../crm/workLinks.js'

describe('Task + RecordLink (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  /** A company, a person, and a deal in one org — the three spine targets. */
  async function seedSpine(orgId: string) {
    const company = await prisma.company.create({ data: { orgId, name: 'Acme' } })
    const person = await prisma.person.create({ data: { orgId, firstName: 'Jane', lastName: 'Doe' } })
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: 'New Business', isDefault: true },
    })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1 },
    })
    const deal = await prisma.deal.create({
      data: { orgId, name: 'Acme expansion', companyId: company.id, pipelineId: pipeline.id, stageId: stage.id },
    })
    return { company, person, deal }
  }

  // ============================================================
  // Acceptance: a task links to a person / company / deal
  // ============================================================
  it('links one task to a person, a company, AND a deal through RecordLink', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { company, person, deal } = await seedSpine(orgId)

    const task = await prisma.task.create({
      data: { orgId, title: 'Call Jane back', type: 'call', priority: 'high' },
    })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId,
        source: 'task',
        sourceId: task.id,
        targets: [
          { object: 'person', id: person.id },
          { object: 'company', id: company.id },
          { object: 'deal', id: deal.id },
        ],
      }),
    )

    // Read back through the relation the schema declares — i.e. through the
    // FOREIGN KEY half of the seam, not just the generic columns.
    const read = await prisma.task.findFirstOrThrow({
      where: { id: task.id, orgId },
      include: { links: { orderBy: { createdAt: 'asc' } } },
    })
    expect(read.links).toHaveLength(3)
    expect(read.links.map((l) => l.toObject).sort()).toEqual(['company', 'deal', 'person'])
    for (const link of read.links) {
      // Both halves written together: the generic edge AND the real key.
      expect(link.fromObject).toBe('task')
      expect(link.fromId).toBe(task.id)
      expect(link.taskId).toBe(task.id)
      expect(link.noteId).toBeNull()
      expect(link.attribute).toBeNull()
      expect(link.orgId).toBe(orgId)
    }

    // And the reverse read — "what work is attached to this company" — is the same
    // one table.
    const onCompany = await idsLinkedToRecord(prisma, {
      orgId,
      source: 'task',
      target: { object: 'company', id: company.id },
    })
    expect(onCompany).toEqual([task.id])
  })

  it('re-syncing replaces the whole set without touching another task’s links', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { company, person } = await seedSpine(orgId)

    const mine = await prisma.task.create({ data: { orgId, title: 'Mine' } })
    const theirs = await prisma.task.create({ data: { orgId, title: 'Theirs' } })
    await prisma.$transaction(async (tx) => {
      await syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: mine.id,
        targets: [{ object: 'person', id: person.id }],
      })
      await syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: theirs.id,
        targets: [{ object: 'company', id: company.id }],
      })
    })

    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: mine.id,
        targets: [{ object: 'company', id: company.id }],
      }),
    )

    const mineLinks = await prisma.recordLink.findMany({ where: { orgId, taskId: mine.id } })
    const theirLinks = await prisma.recordLink.findMany({ where: { orgId, taskId: theirs.id } })
    expect(mineLinks.map((l) => l.toObject)).toEqual(['company'])
    // Untouched: the delete is keyed on the foreign key, not on a shared fromId.
    expect(theirLinks).toHaveLength(1)
  })

  // ============================================================
  // Acceptance: a calendar-derived task is distinguishable
  // ============================================================
  it('tells a calendar-derived task from a hand-made one, even when both carry an eventId', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)

    await prisma.task.create({
      data: { orgId, title: 'Prep for the demo', origin: 'calendar', eventId: 'evt-1' },
    })
    // A rep who linked their OWN task to the same meeting. It has an eventId and is
    // still theirs — which is why `origin` is a stored column and not inferred from
    // `eventId != null`.
    await prisma.task.create({
      data: { orgId, title: 'Bring the pricing sheet', origin: 'manual', eventId: 'evt-1' },
    })
    await prisma.task.create({ data: { orgId, title: 'Unrelated todo' } })

    const fromCalendar = await prisma.task.findMany({
      where: { orgId, origin: 'calendar', deletedAt: null },
    })
    const byHand = await prisma.task.findMany({
      where: { orgId, origin: 'manual', deletedAt: null },
    })

    expect(fromCalendar.map((t) => t.title)).toEqual(['Prep for the demo'])
    expect(byHand.map((t) => t.title).sort()).toEqual(['Bring the pricing sheet', 'Unrelated todo'])

    // Everything attached to that one event, whatever made it.
    const onEvent = await prisma.task.findMany({ where: { orgId, eventId: 'evt-1' } })
    expect(onEvent).toHaveLength(2)
  })

  it('defaults a task to manual origin, so nothing is accidentally a sync’s to rewrite', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const task = await prisma.task.create({ data: { orgId, title: 'Typed by a person' } })
    expect(task.origin).toBe('manual')
    expect(task.type).toBe('todo')
    expect(task.priority).toBe('med')
    expect(task.commitment).toBe('soft')
    expect(task.isDone).toBe(false)
    expect(task.doneAt).toBeNull()
  })

  // ============================================================
  // The foreign keys, and what each delete really does
  // ============================================================
  it('deleting a task cascades its links away, leaving the records it pointed at alone', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { company } = await seedSpine(orgId)
    const task = await prisma.task.create({ data: { orgId, title: 'Temporary' } })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: task.id,
        targets: [{ object: 'company', id: company.id }],
      }),
    )

    await prisma.task.deleteMany({ where: { id: task.id, orgId } })

    expect(await prisma.recordLink.count({ where: { orgId, taskId: task.id } })).toBe(0)
    // The company is untouched — a link is not ownership.
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1)
  })

  it('deleting the assignee keeps the task and just unassigns it', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const other = await prisma.user.create({
      data: { firebaseUid: `fb_t_${Date.now()}`, email: `t_${Date.now()}@example.com` },
    })
    const task = await prisma.task.create({
      data: { orgId, title: 'Still needs doing', assigneeUserId: other.id },
    })

    await prisma.user.delete({ where: { id: other.id } })

    const read = await prisma.task.findFirstOrThrow({ where: { id: task.id, orgId } })
    // SetNull, not Cascade: deleting a person must not delete the org's open work.
    expect(read.assigneeUserId).toBeNull()
  })

  it('trashing a task keeps the row, its links, and who binned it', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { person } = await seedSpine(orgId)
    const task = await prisma.task.create({ data: { orgId, title: 'Binned' } })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: task.id,
        targets: [{ object: 'person', id: person.id }],
      }),
    )

    await prisma.task.updateMany({
      where: { id: task.id, orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: adminUserId },
    })

    const read = await prisma.task.findFirstOrThrow({ where: { id: task.id, orgId } })
    expect(read.deletedAt).not.toBeNull()
    expect(read.deletedById).toBe(adminUserId)
    // A restore must restore what the task was about, so the links stay.
    expect(await prisma.recordLink.count({ where: { orgId, taskId: task.id } })).toBe(1)
  })

  it('deleting the org cascades its tasks and their links away', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const { company } = await seedSpine(orgId)
    const task = await prisma.task.create({ data: { orgId, title: 'Doomed' } })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId, source: 'task', sourceId: task.id,
        targets: [{ object: 'company', id: company.id }],
      }),
    )

    await prisma.org.delete({ where: { id: orgId } })

    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0)
    expect(await prisma.recordLink.count({ where: { taskId: task.id } })).toBe(0)
  })

  // ============================================================
  // Org isolation
  // ============================================================
  it('refuses to attach a task to another org’s record', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const theirCompany = await prisma.company.create({ data: { orgId: b.orgId, name: 'Theirs' } })

    const error = await verifyLinkTargets(prisma, a.orgId, [
      { object: 'company', id: theirCompany.id },
    ])

    // A real id from another org is answered exactly like an id that never existed.
    expect(error).toContain(theirCompany.id)
  })

  it('refuses to attach a task to a TRASHED record', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await prisma.company.create({
      data: { orgId, name: 'Gone', deletedAt: new Date() },
    })

    expect(await verifyLinkTargets(prisma, orgId, [{ object: 'company', id: company.id }])).toContain(
      company.id,
    )
  })

  it('refuses an object slug this org has never defined', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    expect(await verifyLinkTargets(prisma, orgId, [{ object: 'widget', id: 'x' }])).toContain('widget')
  })

  it('attaches a task to a row of a CUSTOM object, verified against Record', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const slug = `project_${Date.now()}`
    const object = await prisma.objectDef.create({
      data: { orgId, slug, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    const row = await prisma.record.create({
      data: { orgId, objectId: object.id, valuesJson: { name: 'Launch' } },
    })

    expect(await verifyLinkTargets(prisma, orgId, [{ object: slug, id: row.id }])).toBeNull()
    // A different id under the same slug is still refused.
    expect(await verifyLinkTargets(prisma, orgId, [{ object: slug, id: 'nope' }])).toContain('nope')

    const task = await prisma.task.create({ data: { orgId, title: 'Ship the launch' } })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, { orgId, source: 'task', sourceId: task.id, targets: [{ object: slug, id: row.id }] }),
    )
    const links = await prisma.recordLink.findMany({ where: { orgId, taskId: task.id } })
    expect(links[0].toObject).toBe(slug)
  })

  it('the attachment lookup never crosses the tenant boundary', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const companyA = await prisma.company.create({ data: { orgId: a.orgId, name: 'A' } })
    const taskA = await prisma.task.create({ data: { orgId: a.orgId, title: 'A task' } })
    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId: a.orgId, source: 'task', sourceId: taskA.id,
        targets: [{ object: 'company', id: companyA.id }],
      }),
    )

    // Org B asking about org A's company id sees nothing.
    expect(
      await idsLinkedToRecord(prisma, {
        orgId: b.orgId, source: 'task', target: { object: 'company', id: companyA.id },
      }),
    ).toEqual([])
  })
})
