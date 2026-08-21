// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite reads schema.prisma as text, so it only proves the model was
// WRITTEN the way the spec says. This proves the migration actually produced it:
// the columns, the index the Templates screen's one query needs, the org cascade,
// and — the decision the module turns on — that a template SURVIVES the rep who
// wrote it, because it belongs to the org and not to them.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedMember, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

describe('EmailTemplate (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores a name, a subject, and a body, and starts with no field list', async () => {
    // Exactly what EC-17's POST will send: the three the rep typed, plus who
    // typed them. fieldsJson stays null until merge fields land.
    const org = await seedOrgWithAdmin(prisma)

    const template = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: org.adminUserId,
        name: 'Follow-up after call',
        subject: 'Great speaking with you',
        bodyHtml: '<p>Thanks for your time today.</p>',
      },
    })

    expect(template.name).toBe('Follow-up after call')
    expect(template.subject).toBe('Great speaking with you')
    // Stored verbatim: the write path never reformats the body.
    expect(template.bodyHtml).toBe('<p>Thanks for your time today.</p>')
    expect(template.fieldsJson).toBeNull()
    expect(template.createdAt).toBeInstanceOf(Date)
    expect(template.updatedAt).toBeInstanceOf(Date)
  })

  it('round-trips a derived field list as JSON', async () => {
    // Derived server-side on every write, never sent by the client. A list of
    // merge-field ids is what it will hold once merge fields land.
    const org = await seedOrgWithAdmin(prisma)

    const template = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: org.adminUserId,
        name: 'Intro',
        subject: 'Hello {{person.firstName}}',
        bodyHtml: '<p>Hi {{person.firstName}}, about {{company.name}}.</p>',
        fieldsJson: ['person.firstName', 'company.name'],
      },
    })

    expect(template.fieldsJson).toEqual(['person.firstName', 'company.name'])
  })

  it('has the composite index the Templates screen query runs on', async () => {
    const schema = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'EmailTemplate' AND schemaname = current_schema()
    `
    const defs = schema.map((row) => row.indexdef).join('\n')

    // Postgres only quotes an identifier that needs it, so `name` comes back bare.
    expect(defs).toMatch(/\("orgId", name\)/)
  })

  it('shows a teammate’s template to the whole org, alphabetically', async () => {
    // The Templates screen's only query, verbatim: orgId ALONE, ordered by name.
    // A rep sees what a colleague wrote — that is what "org-wide" buys.
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)

    await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: colleague.userId,
        name: 'Zebra',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })
    await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: org.adminUserId,
        name: 'Apple',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })

    const found = await prisma.emailTemplate.findMany({
      where: { orgId: org.orgId },
      orderBy: { name: 'asc' },
    })

    expect(found.map((t) => t.name)).toEqual(['Apple', 'Zebra'])
  })

  it('never leaks another org’s template into the list', async () => {
    const mine = await seedOrgWithAdmin(prisma)
    const theirs = await seedOrgWithAdmin(prisma)

    const ours = await prisma.emailTemplate.create({
      data: { orgId: mine.orgId, createdById: mine.adminUserId, name: 'Ours', subject: 's', bodyHtml: '<p>b</p>' },
    })
    await prisma.emailTemplate.create({
      data: { orgId: theirs.orgId, createdById: theirs.adminUserId, name: 'Aaa theirs', subject: 's', bodyHtml: '<p>b</p>' },
    })

    const found = await prisma.emailTemplate.findMany({ where: { orgId: mine.orgId } })

    expect(found.map((t) => t.id)).toEqual([ours.id])
  })

  it('outlives the rep who wrote it — the author’s id goes null, the template stays', async () => {
    // The org-wide decision, proved at the database level. If this ever cascades,
    // a departing rep takes the team's templates with them.
    const org = await seedOrgWithAdmin(prisma)
    const author = await seedMember(prisma, org.orgId)

    const template = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: author.userId,
        name: 'Written by someone who left',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })

    await prisma.user.delete({ where: { id: author.userId } })

    const after = await prisma.emailTemplate.findUnique({ where: { id: template.id } })
    expect(after).not.toBeNull()
    expect(after!.createdById).toBeNull()
    expect(after!.bodyHtml).toBe('<p>b</p>')
  })

  it('cascades from Org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const template = await prisma.emailTemplate.create({
      data: { orgId: org.orgId, createdById: org.adminUserId, name: 'Gone', subject: 's', bodyHtml: '<p>b</p>' },
    })

    await prisma.org.delete({ where: { id: org.orgId } })

    expect(await prisma.emailTemplate.findUnique({ where: { id: template.id } })).toBeNull()
  })
})
