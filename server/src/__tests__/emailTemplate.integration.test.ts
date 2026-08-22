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

  it('stores a name, a subject, and a body, and starts private with no field list', async () => {
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
    expect(template.visibility).toBe('PRIVATE')
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

  it('persists organization visibility when an author shares a template', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const shared = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: org.adminUserId,
        visibility: 'ORGANIZATION',
        name: 'Shared template',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })
    expect(shared.visibility).toBe('ORGANIZATION')
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

  it('keeps an organization template when its author leaves', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const author = await seedMember(prisma, org.orgId)

    const template = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: author.userId,
        visibility: 'ORGANIZATION',
        name: 'Written by someone who left',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })

    await prisma.user.delete({ where: { id: author.userId } })

    const after = await prisma.emailTemplate.findUnique({ where: { id: template.id } })
    expect(after).not.toBeNull()
    expect(after!.createdById).toBeNull()
    expect(after!.visibility).toBe('ORGANIZATION')
    expect(after!.bodyHtml).toBe('<p>b</p>')
  })

  it('deletes only private templates when a member loses this organization', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const anotherOrg = await seedOrgWithAdmin(prisma)
    const member = await seedMember(prisma, org.orgId)
    await prisma.membership.create({
      data: { userId: member.userId, orgId: anotherOrg.orgId, roles: ['basic'] },
    })
    const privateTemplate = await prisma.emailTemplate.create({
      data: { orgId: org.orgId, createdById: member.userId, name: 'Private', subject: 's', bodyHtml: '<p>b</p>' },
    })
    const sharedTemplate = await prisma.emailTemplate.create({
      data: {
        orgId: org.orgId,
        createdById: member.userId,
        visibility: 'ORGANIZATION',
        name: 'Shared',
        subject: 's',
        bodyHtml: '<p>b</p>',
      },
    })
    const otherPrivateTemplate = await prisma.emailTemplate.create({
      data: { orgId: anotherOrg.orgId, createdById: member.userId, name: 'Other private', subject: 's', bodyHtml: '<p>b</p>' },
    })

    await prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({
        where: { userId: member.userId, orgId: org.orgId, isActive: true },
        data: { isActive: false },
      })
      await tx.emailTemplate.deleteMany({
        where: { orgId: org.orgId, createdById: member.userId, visibility: 'PRIVATE' },
      })
    })

    expect(await prisma.emailTemplate.findUnique({ where: { id: privateTemplate.id } })).toBeNull()
    expect(await prisma.emailTemplate.findUnique({ where: { id: sharedTemplate.id } })).not.toBeNull()
    expect(await prisma.emailTemplate.findUnique({ where: { id: otherPrivateTemplate.id } })).not.toBeNull()
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
