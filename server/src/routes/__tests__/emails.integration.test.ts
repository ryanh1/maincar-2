// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it proves the route ASKS for the right reads.
// This proves the things only real row state and real constraints can — which for
// T9 (MAI-137) is the whole acceptance list:
//   - an email whose participants are ALL external stores fine, no Person needed;
//   - re-syncing the same message is idempotent under
//     @@unique([orgId, mailAccountId, internetMessageId]);
//   - a participant matched to a Person later links WITHOUT rewriting the email;
//   - disconnecting a mailbox does not destroy message history (SetNull, not
//     Cascade), and no token or credential is reachable from an Email row.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('Email activity spine (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  /**
   * A connected mailbox, built the way the Integration Hub builds one: an
   * OAuthConnection holding the grant, and a MailAccount hanging off it. Email
   * points at the MailAccount and NEVER at the connection — the token is not
   * something message history has any business reaching.
   */
  async function seedMailbox(
    orgId: string,
    userId: string,
    address = 'rep@ourco.test',
    provider = 'google',
  ): Promise<{ mailAccountId: string; connectionId: string }> {
    const connection = await prisma.oAuthConnection.create({
      data: {
        orgId,
        userId,
        provider,
        providerAccountId: `sub-${Math.random().toString(36).slice(2)}`,
        emailAddress: address,
        refreshToken: 'v1.iv.ciphertext.tag',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
    })
    const mailAccount = await prisma.mailAccount.create({
      data: {
        orgId,
        userId,
        connectionId: connection.id,
        provider,
        emailAddress: address,
        isPrimary: true,
      },
    })
    return { mailAccountId: mailAccount.id, connectionId: connection.id }
  }

  it('stores an email whose participants are ALL external — no Person required (§5.12)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        direction: 'outbound',
        subject: 'Intro',
        bodyText: 'Hello there',
        snippet: 'Hello there',
        internetMessageId: '<external-only@mail.example.com>',
        conversationId: 'thread-ext',
        provider: 'gmail',
        sentAt: new Date('2026-08-20T09:30:00.000Z'),
        participants: {
          create: [
            { orgId, role: 'from', name: 'Rep', address: 'rep@ourco.test' },
            { orgId, role: 'to', name: 'Total Stranger', address: 'stranger@elsewhere.test' },
            { orgId, role: 'cc', address: 'someone-else@elsewhere.test' },
          ],
        },
      },
      include: { participants: true },
    })

    expect(email.participants).toHaveLength(3)
    // Every one of them is unlinked, and every raw address survived intact.
    expect(email.participants.every((p) => p.personId === null)).toBe(true)
    expect(email.participants.map((p) => p.address).sort()).toEqual([
      'rep@ourco.test',
      'someone-else@elsewhere.test',
      'stranger@elsewhere.test',
    ])
    // And no personId on the message itself — an email has MANY participants, so
    // there is no single person for it to point at.
    expect(Object.keys(email)).not.toContain('personId')
  })

  it('is idempotent on re-sync: the same Message-ID in the same mailbox updates, never duplicates', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)
    const internetMessageId = '<resync-me@mail.example.com>'
    const key = { orgId_mailAccountId_internetMessageId: { orgId, mailAccountId, internetMessageId } }

    const first = await prisma.email.upsert({
      where: key,
      create: { orgId, mailAccountId, internetMessageId, direction: 'inbound', subject: 'Re: Intro', isRead: false },
      update: {},
    })

    // The sync runs again over the same window — the ordinary case, not an error.
    const second = await prisma.email.upsert({
      where: key,
      create: { orgId, mailAccountId, internetMessageId, direction: 'inbound', subject: 'Re: Intro', isRead: false },
      update: { isRead: true },
    })

    expect(second.id).toBe(first.id)
    expect(second.isRead).toBe(true)
    expect(await prisma.email.count({ where: { orgId, internetMessageId } })).toBe(1)
  })

  it('rejects a second INSERT of the same message in the same mailbox (the constraint itself)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)
    const internetMessageId = '<dupe@mail.example.com>'

    await prisma.email.create({ data: { orgId, mailAccountId, internetMessageId, direction: 'inbound' } })
    await expect(
      prisma.email.create({ data: { orgId, mailAccountId, internetMessageId, direction: 'inbound' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('keeps the SAME message in TWO mailboxes as two rows — two mailboxes were sent it', async () => {
    // One rep, two connected mailboxes (the Integration Hub allows one grant per
    // provider per rep). The same Message-ID legitimately lands in both, and they
    // are two rows: the dedupe key is the MAILBOX, not the person.
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const inboxA = await seedMailbox(orgId, adminUserId, 'a@ourco.test', 'google')
    const inboxB = await seedMailbox(orgId, adminUserId, 'b@ourco.test', 'microsoft')
    const internetMessageId = '<broadcast@mail.example.com>'

    await prisma.email.create({
      data: { orgId, mailAccountId: inboxA.mailAccountId, internetMessageId, direction: 'inbound' },
    })
    await prisma.email.create({
      data: { orgId, mailAccountId: inboxB.mailAccountId, internetMessageId, direction: 'inbound' },
    })

    expect(await prisma.email.count({ where: { orgId, internetMessageId } })).toBe(2)
  })

  it('does not collide two rows that have no Message-ID yet (NULLs are distinct)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)

    await prisma.email.create({ data: { orgId, mailAccountId, direction: 'outbound', subject: 'One' } })
    await prisma.email.create({ data: { orgId, mailAccountId, direction: 'outbound', subject: 'Two' } })

    expect(await prisma.email.count({ where: { orgId, internetMessageId: null } })).toBe(2)
  })

  it('links a participant to a Person LATER without rewriting the email', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        direction: 'inbound',
        subject: 'Interested',
        internetMessageId: '<later-match@mail.example.com>',
        participants: {
          create: [{ orgId, role: 'from', name: 'Dana Stranger', address: 'dana@elsewhere.test' }],
        },
      },
      include: { participants: true },
    })
    const before = await prisma.email.findFirstOrThrow({ where: { id: email.id, orgId } })

    // Dana becomes a Person — an import, an enrichment, a rep adding them.
    const person = await prisma.person.create({
      data: { orgId, firstName: 'Dana', lastName: 'Stranger' },
    })

    // The match writes personId on the PARTICIPANT row and nothing else. orgId is
    // in the where clause, and updateMany rather than update by id — the tenant
    // key is where the boundary lives.
    const linked = await prisma.emailParticipant.updateMany({
      where: { orgId, address: 'dana@elsewhere.test', personId: null },
      data: { personId: person.id },
    })
    expect(linked.count).toBe(1)

    const after = await prisma.email.findFirstOrThrow({
      where: { id: email.id, orgId },
      include: { participants: true },
    })
    // The participant now links...
    expect(after.participants[0].personId).toBe(person.id)
    // ...its RAW address is untouched...
    expect(after.participants[0].address).toBe('dana@elsewhere.test')
    // ...and the EMAIL row itself was not rewritten at all.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    expect(after.subject).toBe('Interested')
    expect(after.internetMessageId).toBe('<later-match@mail.example.com>')

    // And the Person can reach the message from their side.
    const fromPerson = await prisma.person.findFirstOrThrow({
      where: { id: person.id, orgId },
      include: { emailParticipations: true },
    })
    expect(fromPerson.emailParticipations.map((p) => p.emailId)).toEqual([email.id])
  })

  it('keeps the message when the Person is deleted — the raw address survives (SetNull)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId)
    const person = await prisma.person.create({ data: { orgId, firstName: 'Gone' } })

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        direction: 'inbound',
        internetMessageId: '<person-deleted@mail.example.com>',
        participants: { create: [{ orgId, role: 'from', address: 'gone@elsewhere.test', personId: person.id }] },
      },
    })

    await prisma.person.deleteMany({ where: { id: person.id, orgId } })

    const after = await prisma.email.findFirstOrThrow({
      where: { id: email.id, orgId },
      include: { participants: true },
    })
    expect(after.participants[0].personId).toBeNull()
    expect(after.participants[0].address).toBe('gone@elsewhere.test')
  })

  it('keeps the message when the MAILBOX is disconnected — SetNull, never Cascade', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId, connectionId } = await seedMailbox(orgId, adminUserId, 'leaving@ourco.test')

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        direction: 'outbound',
        subject: 'Said before they left',
        internetMessageId: '<mailbox-gone@mail.example.com>',
      },
    })

    // Deleting the grant cascades the mailbox away — that is the Integration Hub's
    // own rule, untouched here. What must NOT follow is the message history.
    await prisma.oAuthConnection.deleteMany({ where: { id: connectionId, orgId } })
    expect(await prisma.mailAccount.count({ where: { id: mailAccountId, orgId } })).toBe(0)

    const survivor = await prisma.email.findFirstOrThrow({ where: { id: email.id, orgId } })
    expect(survivor.mailAccountId).toBeNull()
    expect(survivor.subject).toBe('Said before they left')
  })

  it('rolls a message up to a Company and a Deal, and survives losing either (SetNull)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId, 'rollup@ourco.test')
    const company = await prisma.company.create({ data: { orgId, name: 'Acme' } })
    const pipeline = await prisma.pipeline.create({ data: { orgId, name: 'New Business', isDefault: true } })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1 },
    })
    const deal = await prisma.deal.create({
      data: { orgId, name: 'Acme expansion', companyId: company.id, pipelineId: pipeline.id, stageId: stage.id },
    })

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        companyId: company.id,
        dealId: deal.id,
        direction: 'outbound',
        internetMessageId: '<rollup@mail.example.com>',
        sentAt: new Date('2026-08-19T10:00:00.000Z'),
      },
    })

    // The account feed's query: one indexed round-trip, newest first.
    const feed = await prisma.email.findMany({
      where: { orgId, companyId: company.id },
      orderBy: [{ sentAt: 'desc' }],
    })
    expect(feed.map((e) => e.id)).toEqual([email.id])

    await prisma.deal.deleteMany({ where: { id: deal.id, orgId } })
    await prisma.company.deleteMany({ where: { id: company.id, orgId } })

    const survivor = await prisma.email.findFirstOrThrow({ where: { id: email.id, orgId } })
    expect(survivor.dealId).toBeNull()
    expect(survivor.companyId).toBeNull()
  })

  it('stores attachments, inline and not, and cascades them with the message', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId, 'attach@ourco.test')

    const email = await prisma.email.create({
      data: {
        orgId,
        mailAccountId,
        direction: 'inbound',
        internetMessageId: '<with-attachments@mail.example.com>',
        hasAttachments: true,
        bodyHtml: '<p>See <img src="cid:logo123"> and the PDF.</p>',
        participants: { create: [{ orgId, role: 'from', address: 'sender@elsewhere.test' }] },
        attachments: {
          create: [
            { orgId, filename: 'proposal.pdf', contentType: 'application/pdf', sizeBytes: 4096, providerAttachmentId: 'att-1' },
            { orgId, filename: 'logo.png', contentType: 'image/png', sizeBytes: 812, isInline: true, contentId: 'logo123' },
          ],
        },
      },
      include: { attachments: { orderBy: { filename: 'asc' } } },
    })

    expect(email.attachments).toHaveLength(2)
    expect(email.attachments.map((a) => a.filename)).toEqual(['logo.png', 'proposal.pdf'])
    // The inline one is matched to the body by contentId, and neither has our copy
    // yet — the download job has not run.
    expect(email.attachments[0].isInline).toBe(true)
    expect(email.attachments[0].contentId).toBe('logo123')
    expect(email.attachments.every((a) => a.storageUrl === null)).toBe(true)

    await prisma.email.deleteMany({ where: { id: email.id, orgId } })
    expect(await prisma.emailAttachment.count({ where: { orgId, emailId: email.id } })).toBe(0)
    expect(await prisma.emailParticipant.count({ where: { orgId, emailId: email.id } })).toBe(0)
  })

  it('keeps one org out of another org message list', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const inboxA = await seedMailbox(a.orgId, a.adminUserId, 'a@a.test')
    const inboxB = await seedMailbox(b.orgId, b.adminUserId, 'b@b.test')
    const internetMessageId = '<cross-org@mail.example.com>'

    await prisma.email.create({
      data: { orgId: a.orgId, mailAccountId: inboxA.mailAccountId, internetMessageId, direction: 'inbound', subject: 'A' },
    })
    await prisma.email.create({
      data: { orgId: b.orgId, mailAccountId: inboxB.mailAccountId, internetMessageId, direction: 'inbound', subject: 'B' },
    })

    const listA = await prisma.email.findMany({ where: { orgId: a.orgId } })
    expect(listA.map((e) => e.subject)).toEqual(['A'])
    // And an id from org B is not findable under org A's tenant key.
    const bRow = await prisma.email.findFirstOrThrow({ where: { orgId: b.orgId } })
    expect(await prisma.email.findFirst({ where: { id: bRow.id, orgId: a.orgId } })).toBeNull()
  })

  it('reaches no credential from an Email row: the mailbox relation stops at MailAccount', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const { mailAccountId } = await seedMailbox(orgId, adminUserId, 'nocreds@ourco.test')
    const email = await prisma.email.create({
      data: { orgId, mailAccountId, direction: 'outbound', internetMessageId: '<nocreds@mail.example.com>' },
    })

    // Every column the Email table actually has. If a token column is ever added,
    // this fails — which is the point.
    const row = await prisma.email.findFirstOrThrow({ where: { id: email.id, orgId } })
    const secretish = Object.keys(row).filter((k) => /token|secret|scope|credential|password/i.test(k))
    expect(secretish).toEqual([])
  })
})
