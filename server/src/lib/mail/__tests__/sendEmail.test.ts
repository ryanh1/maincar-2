// sendEmail.test.ts — composer-send's orchestration (SPEC-composer-send.md →
// Testing strategy). The provider is mocked; no test here sends a real email.
//
// What these protect:
//   - no mailbox (neither the draft's own nor a primary one) → NoMailboxError,
//     and the draft is never touched
//   - an empty To, a malformed address, or over 100 recipients → BadRecipientError,
//     and the draft is never touched
//   - a successful send creates exactly one Email row (with its participants)
//     and deletes the draft — in that order
//   - a provider throw leaves the draft in place, with its body intact
//   - the body that is sent is sanitised, and it is the SAME string that is
//     recorded (CLAUDE.md → AI drafting)

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, getMailProviderMock } = vi.hoisted(() => {
  const mailAccount = { findFirst: vi.fn() }
  const email = { create: vi.fn() }
  const emailDraft = { deleteMany: vi.fn() }
  return {
    prismaMock: { mailAccount, email, emailDraft },
    getMailProviderMock: vi.fn(),
  }
})

vi.mock('../../../db.js', () => ({ default: prismaMock }))
vi.mock('../getMailProvider.js', () => ({ getMailProvider: getMailProviderMock }))

import { sendDraftEmail, BadRecipientError, NoMailboxError } from '../sendEmail.js'
import type { EmailDraft } from '../../../generated/prisma/client.js'

const ORG_ID = 'org-a'
const USER_ID = 'user-a'

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    orgId: ORG_ID,
    userId: USER_ID,
    mailAccountId: null,
    recordObject: null,
    recordId: null,
    toAddrs: ['client@example.com'],
    ccAddrs: [],
    bccAddrs: [],
    subject: 'Quarterly review',
    bodyHtml: '<p>Hello</p>',
    isOpen: true,
    isMinimized: false,
    createdAt: new Date('2026-08-20T12:00:00.000Z'),
    updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    ...overrides,
  } as EmailDraft
}

function mailAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'box-1',
    orgId: ORG_ID,
    userId: USER_ID,
    provider: 'google',
    emailAddress: 'rep@example.com',
    isPrimary: true,
    ...overrides,
  }
}

const SENT = {
  providerMsgId: 'gmail-msg-1',
  threadId: 'gmail-thread-1',
  sentAt: new Date('2026-08-21T09:00:00.000Z'),
}

function stubProvider(sendEmail = vi.fn().mockResolvedValue(SENT)) {
  getMailProviderMock.mockResolvedValue({ provider: 'google', sendEmail })
  return sendEmail
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.mailAccount.findFirst.mockResolvedValue(mailAccountRow())
  prismaMock.email.create.mockResolvedValue({ id: 'email-1' })
  prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 1 })
})

describe('sendDraftEmail — mailbox resolution', () => {
  it('sends from the primary mailbox when the draft never set one', async () => {
    stubProvider()

    await sendDraftEmail(ORG_ID, USER_ID, draft({ mailAccountId: null }))

    expect(prismaMock.mailAccount.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, userId: USER_ID, isPrimary: true },
    })
  })

  it("sends from the draft's own mailbox when it has one", async () => {
    stubProvider()

    await sendDraftEmail(ORG_ID, USER_ID, draft({ mailAccountId: 'box-2' }))

    expect(prismaMock.mailAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'box-2', orgId: ORG_ID, userId: USER_ID },
    })
  })

  it('throws NoMailboxError, and touches nothing, when no mailbox resolves', async () => {
    prismaMock.mailAccount.findFirst.mockResolvedValue(null)
    stubProvider()

    await expect(sendDraftEmail(ORG_ID, USER_ID, draft())).rejects.toBeInstanceOf(NoMailboxError)

    expect(prismaMock.email.create).not.toHaveBeenCalled()
    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
  })
})

describe('sendDraftEmail — deliverability validation', () => {
  it('throws BadRecipientError, and touches nothing, on an empty To', async () => {
    stubProvider()

    await expect(
      sendDraftEmail(ORG_ID, USER_ID, draft({ toAddrs: [] })),
    ).rejects.toBeInstanceOf(BadRecipientError)

    expect(prismaMock.email.create).not.toHaveBeenCalled()
  })

  it('throws BadRecipientError naming the address, on a malformed one', async () => {
    stubProvider()

    await expect(
      sendDraftEmail(ORG_ID, USER_ID, draft({ toAddrs: ['ann@'] })),
    ).rejects.toThrow('ann@')
  })

  it('throws BadRecipientError past 100 recipients across To + Cc + Bcc', async () => {
    stubProvider()
    const many = Array.from({ length: 101 }, (_, i) => `person${i}@example.com`)

    await expect(
      sendDraftEmail(ORG_ID, USER_ID, draft({ toAddrs: many })),
    ).rejects.toBeInstanceOf(BadRecipientError)
  })

  it('checks Cc and Bcc addresses too, not just To', async () => {
    stubProvider()

    await expect(
      sendDraftEmail(ORG_ID, USER_ID, draft({ ccAddrs: ['not-an-address'] })),
    ).rejects.toBeInstanceOf(BadRecipientError)
  })
})

describe('sendDraftEmail — success', () => {
  it('deletes a draft accepted by Graph without fabricating an Email record', async () => {
    getMailProviderMock.mockResolvedValue({
      provider: 'microsoft',
      sendEmail: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    })

    await expect(sendDraftEmail(ORG_ID, USER_ID, draft())).resolves.toEqual({ accepted: true })

    expect(prismaMock.email.create).not.toHaveBeenCalled()
    expect(prismaMock.emailDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: 'draft-1', orgId: ORG_ID, userId: USER_ID },
    })
  })

  it('creates exactly one Email row with its participants, then deletes the draft', async () => {
    const sendEmail = stubProvider()

    await sendDraftEmail(
      ORG_ID,
      USER_ID,
      draft({ toAddrs: ['ann@acme.test'], ccAddrs: ['bob@acme.test'] }),
    )

    expect(prismaMock.email.create).toHaveBeenCalledTimes(1)
    const created = prismaMock.email.create.mock.calls[0][0].data
    expect(created.orgId).toBe(ORG_ID)
    expect(created.mailAccountId).toBe('box-1')
    expect(created.direction).toBe('outbound')
    expect(created.providerMessageId).toBe('gmail-msg-1')
    expect(created.providerThreadId).toBe('gmail-thread-1')
    expect(created.sentAt).toBe(SENT.sentAt)
    expect(created.participants.create).toEqual([
      { orgId: ORG_ID, role: 'from', address: 'rep@example.com' },
      { orgId: ORG_ID, role: 'to', address: 'ann@acme.test' },
      { orgId: ORG_ID, role: 'cc', address: 'bob@acme.test' },
    ])

    // Record before delete: the create call happened before the deleteMany call.
    expect(prismaMock.email.create.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.emailDraft.deleteMany.mock.invocationCallOrder[0],
    )
    expect(prismaMock.emailDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: 'draft-1', orgId: ORG_ID, userId: USER_ID },
    })

    expect(sendEmail).toHaveBeenCalledWith({
      to: [{ email: 'ann@acme.test' }],
      cc: [{ email: 'bob@acme.test' }],
      bcc: undefined,
      subject: 'Quarterly review',
      bodyHtml: '<p>Hello</p>',
    })
  })

  it('sends the same bodyHtml it records — never a second computed value', async () => {
    const sendEmail = stubProvider()

    await sendDraftEmail(
      ORG_ID,
      USER_ID,
      draft({ bodyHtml: '<p>Numbers <strong>attached</strong>.</p>' }),
    )

    const created = prismaMock.email.create.mock.calls[0][0].data
    const sentArgs = sendEmail.mock.calls[0][0] as { bodyHtml: string }
    expect(created.bodyHtml).toBe(sentArgs.bodyHtml)
    expect(created.bodyHtml).toBe('<p>Numbers <strong>attached</strong>.</p>')
  })

  it('sanitises the body before it is sent or recorded', async () => {
    const sendEmail = stubProvider()

    await sendDraftEmail(
      ORG_ID,
      USER_ID,
      draft({ bodyHtml: '<p>Hi</p><script>alert(1)</script>' }),
    )

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bodyHtml: expect.not.stringContaining('<script') }),
    )
    const created = prismaMock.email.create.mock.calls[0][0].data
    expect(created.bodyHtml).not.toContain('<script')
  })

  it('maps a Microsoft mailbox to the m365 provider label on the record', async () => {
    prismaMock.mailAccount.findFirst.mockResolvedValue(mailAccountRow({ provider: 'microsoft' }))
    stubProvider()

    await sendDraftEmail(ORG_ID, USER_ID, draft())

    expect(prismaMock.email.create.mock.calls[0][0].data.provider).toBe('m365')
  })
})

describe('sendDraftEmail — provider failure', () => {
  it('propagates the provider error and touches neither the draft nor the record', async () => {
    stubProvider(vi.fn().mockRejectedValue(new Error('Gmail rejected it')))

    await expect(sendDraftEmail(ORG_ID, USER_ID, draft())).rejects.toThrow('Gmail rejected it')

    expect(prismaMock.email.create).not.toHaveBeenCalled()
    expect(prismaMock.emailDraft.deleteMany).not.toHaveBeenCalled()
  })
})
