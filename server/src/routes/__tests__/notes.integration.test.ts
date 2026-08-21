// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma and proves the route wiring. This proves the T13
// acceptance criteria themselves, which only real rows and real constraints can:
//   - ONE note links to MANY records — through the EXISTING RecordLink table, not
//     a parallel link table, and not through columns on Note;
//   - the note and its ONE feed row commit together, and a rolled-back note leaves
//     NO feed row claiming it was written;
//   - re-saving refreshes that row rather than appending a second one;
//   - the flattened bodyText is what makes a note findable;
//   - org isolation and the cascades hold.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { Prisma } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { activityFromNote, recordActivityInTx } from '../../crm/activityFeed.js'
import { flattenTipTapText, rollUpSpineLinks, type LinkTarget } from '../../crm/taskNote.js'
import { idsLinkedToRecord, loadWorkLinks, syncWorkLinks } from '../../crm/workLinks.js'

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('Note + RecordLink + the feed (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function seedSpine(orgId: string) {
    const company = await prisma.company.create({ data: { orgId, name: 'Acme' } })
    const jane = await prisma.person.create({ data: { orgId, firstName: 'Jane', lastName: 'Doe' } })
    const raj = await prisma.person.create({ data: { orgId, firstName: 'Raj', lastName: 'Patel' } })
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: 'New Business', isDefault: true },
    })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1 },
    })
    const deal = await prisma.deal.create({
      data: { orgId, name: 'Acme expansion', companyId: company.id, pipelineId: pipeline.id, stageId: stage.id },
    })
    return { company, jane, raj, deal }
  }

  /** The route's write path, without the HTTP round-trip: note + links + feed row. */
  async function writeNote(args: {
    orgId: string
    authorUserId: string | null
    text: string
    targets: LinkTarget[]
  }) {
    const bodyJson = doc(args.text)
    const bodyText = flattenTipTapText(bodyJson)
    return prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          orgId: args.orgId,
          authorUserId: args.authorUserId,
          bodyJson: bodyJson as Prisma.InputJsonValue,
          bodyText,
        },
      })
      await syncWorkLinks(tx, {
        orgId: args.orgId, source: 'note', sourceId: note.id, targets: args.targets,
      })
      await recordActivityInTx(tx, activityFromNote(note, rollUpSpineLinks(args.targets)))
      return note
    })
  }

  // ============================================================
  // Acceptance: a note links to MANY records
  // ============================================================
  it('links ONE note to a company, TWO people, and a deal at the same time', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company, jane, raj, deal } = await seedSpine(orgId)

    const note = await writeNote({
      orgId,
      authorUserId: adminUserId,
      text: 'Recap of the demo. They want pricing by Friday.',
      targets: [
        { object: 'company', id: company.id },
        { object: 'person', id: jane.id },
        { object: 'person', id: raj.id },
        { object: 'deal', id: deal.id },
      ],
    })

    // Read back through the declared relation — the FOREIGN KEY half of the seam.
    const read = await prisma.note.findFirstOrThrow({
      where: { id: note.id, orgId },
      include: { links: { orderBy: { createdAt: 'asc' } } },
    })
    expect(read.links).toHaveLength(4)
    for (const link of read.links) {
      expect(link.fromObject).toBe('note')
      expect(link.fromId).toBe(note.id)
      expect(link.noteId).toBe(note.id)
      expect(link.taskId).toBeNull()
      expect(link.attribute).toBeNull()
      expect(link.orgId).toBe(orgId)
    }
    // Four attachments, TWO of them people — which a nullable personId column on
    // Note could not have held. That is why there is no such column.
    expect(read.links.filter((l) => l.toObject === 'person').map((l) => l.toId).sort()).toEqual(
      [jane.id, raj.id].sort(),
    )

    // And the same note is found from each record it is attached to.
    for (const target of [
      { object: 'company', id: company.id },
      { object: 'person', id: jane.id },
      { object: 'person', id: raj.id },
      { object: 'deal', id: deal.id },
    ]) {
      expect(await idsLinkedToRecord(prisma, { orgId, source: 'note', target })).toEqual([note.id])
    }
  })

  it('re-attaching replaces the whole set, and only this note’s', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company, jane, deal } = await seedSpine(orgId)

    const mine = await writeNote({
      orgId, authorUserId: adminUserId, text: 'First pass',
      targets: [{ object: 'company', id: company.id }, { object: 'person', id: jane.id }],
    })
    const theirs = await writeNote({
      orgId, authorUserId: adminUserId, text: 'Someone else’s note',
      targets: [{ object: 'deal', id: deal.id }],
    })

    await prisma.$transaction((tx) =>
      syncWorkLinks(tx, {
        orgId, source: 'note', sourceId: mine.id, targets: [{ object: 'deal', id: deal.id }],
      }),
    )

    expect(await loadWorkLinks(prisma, { orgId, source: 'note', sourceId: mine.id })).toEqual([
      { toObject: 'deal', toId: deal.id },
    ])
    expect(await loadWorkLinks(prisma, { orgId, source: 'note', sourceId: theirs.id })).toHaveLength(1)
  })

  it('a note attached to nothing is still a note', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const note = await writeNote({ orgId, authorUserId: adminUserId, text: 'Just thinking', targets: [] })

    expect(await prisma.recordLink.count({ where: { orgId, noteId: note.id } })).toBe(0)
    const feed = await prisma.activityEntry.findFirstOrThrow({
      where: { orgId, sourceType: 'note', sourceId: note.id },
    })
    expect(feed.companyId).toBeNull()
    expect(feed.personId).toBeNull()
    expect(feed.dealId).toBeNull()
  })

  // ============================================================
  // The feed row: atomic, and exactly one
  // ============================================================
  it('writes the note and its ONE feed row in the same commit', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company, jane } = await seedSpine(orgId)

    const note = await writeNote({
      orgId, authorUserId: adminUserId, text: 'They want pricing by Friday.',
      targets: [{ object: 'company', id: company.id }, { object: 'person', id: jane.id }],
    })

    const feed = await prisma.activityEntry.findMany({
      where: { orgId, sourceType: 'note', sourceId: note.id },
    })
    expect(feed).toHaveLength(1)
    expect(feed[0].summary).toBe('Note: They want pricing by Friday.')
    expect(feed[0].direction).toBeNull()
    expect(feed[0].createdByUserId).toBe(adminUserId)
    // The at-most-one spine link a feed row can carry, out of the many the note has.
    expect(feed[0].companyId).toBe(company.id)
    expect(feed[0].personId).toBe(jane.id)
    expect(feed[0].occurredAt).toEqual(note.createdAt)
  })

  it('a rolled-back note leaves NO feed row claiming it was written', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const before = await prisma.activityEntry.count({ where: { orgId, sourceType: 'note' } })

    await expect(
      prisma.$transaction(async (tx) => {
        const note = await tx.note.create({
          data: {
            orgId,
            authorUserId: adminUserId,
            bodyJson: doc('This never happened') as Prisma.InputJsonValue,
            bodyText: 'This never happened',
          },
        })
        await recordActivityInTx(tx, activityFromNote(note, {}))
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await prisma.note.count({ where: { orgId } })).toBe(0)
    expect(await prisma.activityEntry.count({ where: { orgId, sourceType: 'note' } })).toBe(before)
  })

  it('re-saving refreshes the one feed row instead of appending a second', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { deal } = await seedSpine(orgId)

    const note = await writeNote({
      orgId, authorUserId: adminUserId, text: 'First draft', targets: [],
    })

    // The edit path: same note, new text, now attached to a deal.
    await prisma.$transaction(async (tx) => {
      const targets = [{ object: 'deal', id: deal.id }]
      await tx.note.updateMany({
        where: { id: note.id, orgId },
        data: { bodyJson: doc('They signed.') as Prisma.InputJsonValue, bodyText: 'They signed.' },
      })
      await syncWorkLinks(tx, { orgId, source: 'note', sourceId: note.id, targets })
      await recordActivityInTx(
        tx,
        activityFromNote(
          { ...note, bodyText: 'They signed.' },
          rollUpSpineLinks(targets),
        ),
      )
    })

    const feed = await prisma.activityEntry.findMany({
      where: { orgId, sourceType: 'note', sourceId: note.id },
    })
    expect(feed).toHaveLength(1)
    expect(feed[0].summary).toBe('Note: They signed.')
    expect(feed[0].dealId).toBe(deal.id)
    // Editing must not jump the note to the top of a history.
    expect(feed[0].occurredAt).toEqual(note.createdAt)
  })

  it('trashing a note removes its feed row, keeping the note and its links', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company } = await seedSpine(orgId)
    const note = await writeNote({
      orgId, authorUserId: adminUserId, text: 'Binned',
      targets: [{ object: 'company', id: company.id }],
    })

    await prisma.$transaction(async (tx) => {
      await tx.note.updateMany({
        where: { id: note.id, orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      await tx.activityEntry.deleteMany({ where: { orgId, sourceType: 'note', sourceId: note.id } })
    })

    const read = await prisma.note.findFirstOrThrow({ where: { id: note.id, orgId } })
    expect(read.deletedAt).not.toBeNull()
    // A restore must restore what it was about.
    expect(await prisma.recordLink.count({ where: { orgId, noteId: note.id } })).toBe(1)
    // The feed is read without a join back, so no line may outlive the row.
    expect(
      await prisma.activityEntry.count({ where: { orgId, sourceType: 'note', sourceId: note.id } }),
    ).toBe(0)
  })

  // ============================================================
  // bodyText — the column that makes a note findable
  // ============================================================
  it('finds a note by text that only exists once the document is flattened', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const bodyJson = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Next steps' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Budget is ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'confirmed' },
            { type: 'text', text: ' for Q4.' },
          ],
        },
      ],
    }
    const bodyText = flattenTipTapText(bodyJson)
    await prisma.note.create({
      data: {
        orgId, authorUserId: adminUserId,
        bodyJson: bodyJson as Prisma.InputJsonValue,
        bodyText,
      },
    })

    // The phrase spans three separate text nodes in the document, so it is only a
    // phrase at all because bodyText exists.
    const hits = await prisma.note.findMany({
      where: { orgId, deletedAt: null, bodyText: { contains: 'Budget is confirmed', mode: 'insensitive' } },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].bodyText).toBe('Next steps\nBudget is confirmed for Q4.')
  })

  // ============================================================
  // Cascades and isolation
  // ============================================================
  it('deleting a note cascades its links, leaving the records it pointed at alone', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company } = await seedSpine(orgId)
    const note = await writeNote({
      orgId, authorUserId: adminUserId, text: 'Temporary',
      targets: [{ object: 'company', id: company.id }],
    })

    await prisma.note.deleteMany({ where: { id: note.id, orgId } })

    expect(await prisma.recordLink.count({ where: { orgId, noteId: note.id } })).toBe(0)
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1)
  })

  it('deleting the author keeps the note and just drops the byline', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const other = await prisma.user.create({
      data: { firebaseUid: `fb_n_${Date.now()}`, email: `n_${Date.now()}@example.com` },
    })
    const note = await writeNote({ orgId, authorUserId: other.id, text: 'What was said', targets: [] })

    await prisma.user.delete({ where: { id: other.id } })

    const read = await prisma.note.findFirstOrThrow({ where: { id: note.id, orgId } })
    // SetNull: deleting the rep must not delete the org's memory of what was said.
    expect(read.authorUserId).toBeNull()
    expect(read.bodyText).toBe('What was said')
  })

  it('deleting the org cascades its notes, their links, and their feed rows away', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { company } = await seedSpine(orgId)
    const note = await writeNote({
      orgId, authorUserId: adminUserId, text: 'Doomed',
      targets: [{ object: 'company', id: company.id }],
    })

    await prisma.org.delete({ where: { id: orgId } })

    expect(await prisma.note.count({ where: { id: note.id } })).toBe(0)
    expect(await prisma.recordLink.count({ where: { noteId: note.id } })).toBe(0)
    expect(await prisma.activityEntry.count({ where: { sourceId: note.id } })).toBe(0)
  })

  it('one org’s notes are invisible to another, even by exact id', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const note = await writeNote({
      orgId: a.orgId, authorUserId: a.adminUserId, text: 'Private', targets: [],
    })

    expect(await prisma.note.findFirst({ where: { id: note.id, orgId: b.orgId } })).toBeNull()
    expect(await prisma.note.findFirst({ where: { id: note.id, orgId: a.orgId } })).not.toBeNull()
  })
})
