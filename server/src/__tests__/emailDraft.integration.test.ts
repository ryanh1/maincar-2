// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite reads schema.prisma as text, so it only proves the model was
// WRITTEN the way the spec says. This proves the migration actually produced
// those columns: the defaults a new card is born with, the index the dock's one
// query needs, and the two cascades that stop a deleted org or user leaving
// orphaned drafts behind.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedMember, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

describe('EmailDraft (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('is born open, expanded, and empty — POST creates the row before a key is typed', async () => {
    const org = await seedOrgWithAdmin(prisma)

    // Exactly what the create route will send: the two ids and nothing else.
    const draft = await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: org.adminUserId },
    })

    expect(draft.isOpen).toBe(true)
    expect(draft.toAddrs).toEqual([])
    expect(draft.ccAddrs).toEqual([])
    expect(draft.bccAddrs).toEqual([])
    expect(draft.subject).toBeNull()
    expect(draft.bodyHtml).toBeNull()
    expect(draft.mailAccountId).toBeNull()
    expect(draft.recordId).toBeNull()
    expect(draft.createdAt).toBeInstanceOf(Date)
    expect(draft.updatedAt).toBeInstanceOf(Date)
  })

  it('stores the body and addresses verbatim, with a real mailAccountId', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_draft',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.a.b.c',
      },
    })
    const mailbox = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: org.adminEmail,
      },
    })

    const draft = await prisma.emailDraft.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        mailAccountId: mailbox.id,
        toAddrs: ['ann@'],
        ccAddrs: ['cc@example.com'],
        bccAddrs: ['bcc@example.com'],
        subject: 'Re: Quote',
        bodyHtml: '<p>Half a sentence',
      },
    })

    expect(draft.mailAccountId).toBe(mailbox.id)
    // Stored verbatim: the write path never reformats the body.
    expect(draft.bodyHtml).toBe('<p>Half a sentence')
    expect(draft.toAddrs).toEqual(['ann@'])
  })

  it('rejects a mailAccountId that references no MailAccount row (MAI-188 — a real FK now)', async () => {
    const org = await seedOrgWithAdmin(prisma)

    await expect(
      prisma.emailDraft.create({
        data: {
          orgId: org.orgId,
          userId: org.adminUserId,
          mailAccountId: 'mail_account_that_does_not_exist',
        },
      }),
    ).rejects.toThrow()
  })

  it('SetNulls mailAccountId when the mailbox is disconnected — the draft survives', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_setnull',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.a.b.c',
      },
    })
    const mailbox = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: org.adminEmail,
      },
    })
    const draft = await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: org.adminUserId, mailAccountId: mailbox.id },
    })

    await prisma.mailAccount.delete({ where: { id: mailbox.id } })

    const reread = await prisma.emailDraft.findUnique({ where: { id: draft.id } })
    expect(reread).not.toBeNull()
    expect(reread!.mailAccountId).toBeNull()
  })

  it('accepts a recordObject/recordId pair that references no table', async () => {
    // Still bare Strings on purpose (MAI-188): recordObject can name Person,
    // Company, or Deal, and one column cannot be a foreign key into all three —
    // the route enforces existence, not a database constraint.
    const org = await seedOrgWithAdmin(prisma)

    const draft = await prisma.emailDraft.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        recordObject: 'person',
        recordId: 'crm_record_that_does_not_exist',
      },
    })

    expect(draft.recordObject).toBe('person')
    expect(draft.recordId).toBe('crm_record_that_does_not_exist')
  })

  it('has the composite index the dock query runs on', async () => {
    const schema = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'EmailDraft' AND schemaname = current_schema()
    `
    const defs = schema.map((row) => row.indexdef).join('\n')

    expect(defs).toMatch(/\("orgId", "userId", "updatedAt"\)/)
  })

  it('reads a rep’s drafts in one org without seeing a colleague’s', async () => {
    // The dock's only query, verbatim — both filters, always.
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)

    const mine = await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: org.adminUserId, subject: 'Mine' },
    })
    await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: colleague.userId, subject: 'Theirs' },
    })

    const found = await prisma.emailDraft.findMany({
      where: { orgId: org.orgId, userId: org.adminUserId },
      orderBy: { updatedAt: 'asc' },
    })

    expect(found.map((d) => d.id)).toEqual([mine.id])
  })

  it('cascades from Org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const draft = await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: org.adminUserId },
    })

    await prisma.org.delete({ where: { id: org.orgId } })

    expect(await prisma.emailDraft.findUnique({ where: { id: draft.id } })).toBeNull()
  })

  it('cascades from User', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const draft = await prisma.emailDraft.create({
      data: { orgId: org.orgId, userId: colleague.userId },
    })

    await prisma.user.delete({ where: { id: colleague.userId } })

    expect(await prisma.emailDraft.findUnique({ where: { id: draft.id } })).toBeNull()
    // The org is untouched — only the departing user's own drafts went with them.
    expect(await prisma.org.findUnique({ where: { id: org.orgId } })).not.toBeNull()
  })
})
