// getMailProvider.test.ts — the factory and the ONE switch on provider (IH-17).
//
// What these protect:
//   - a Google mailbox row resolves to a provider whose `provider` is 'google' and
//     whose `sendEmail` actually works against a mocked Gmail transport
//   - a Microsoft mailbox row resolves to the Graph implementation, likewise
//   - the lookup is scoped to (id, orgId): a deleted mailbox and another org's
//     mailbox BOTH throw MailboxNotFoundError, indistinguishably — no cross-tenant leak
//   - a provider string with no implementation fails loud with MailApiError
//
// No test here reaches Google or Microsoft. Three seams are mocked:
//   - prisma, so the mailbox lookup returns a fixture row (or null)
//   - withFreshAccessToken, so the implementations' default client factory never
//     touches the token store
//   - the Gmail and Graph SDK wrappers under server/dependencies/, so `sendEmail`
//     runs every real line of googleMail/microsoftMail against a fake transport.
// The factory itself — the findFirst, the org scoping, the switch — runs for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, mailAccount } = vi.hoisted(() => {
  const mailAccount = { findFirst: vi.fn() }
  return { mailAccount, prismaMock: { mailAccount } }
})

// prisma: getMailProvider reads the mailbox through this.
vi.mock('../../../db.js', () => ({ default: prismaMock }))

// withFreshAccessToken: googleMail/microsoftMail call it inside their default client
// factory. Stub it so no test reaches the token store; the token value is irrelevant
// because the SDK wrappers below are mocked and ignore it.
vi.mock('../oauthConnections.js', () => ({
  withFreshAccessToken: vi.fn(async () => 'fake-access-token'),
}))

// The Gmail SDK wrapper. Its `sendMessage` returns Gmail's own send receipt shape,
// which googleMail parses and maps onto SentEmail.
const GMAIL_INTERNAL_DATE = '1700000000000'
vi.mock('../../../../dependencies/gmail.js', () => ({
  gmailClient: () => ({
    sendMessage: vi.fn(async (_raw: string, threadId?: string) => ({
      id: 'gmail-msg-1',
      threadId: threadId ?? 'gmail-thread-1',
      internalDate: GMAIL_INTERNAL_DATE,
    })),
  }),
}))

// The Graph SDK wrapper. Its `sendMail` returns Graph's send receipt shape.
const GRAPH_SENT_DATE = '2026-01-02T03:04:05.000Z'
vi.mock('../../../../dependencies/graph.js', () => ({
  graphClient: () => ({
    sendMail: vi.fn(async () => ({
      id: 'graph-msg-1',
      conversationId: 'graph-conv-1',
      sentDateTime: GRAPH_SENT_DATE,
    })),
  }),
}))

import { getMailProvider } from '../getMailProvider.js'
import { MailApiError, MailboxNotFoundError } from '../mailErrors.js'

const ORG_ID = 'org-a'
const OTHER_ORG_ID = 'org-b'

/** A mailbox row as prisma's `select` in getMailProvider returns it. */
function mailboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'box-1',
    provider: 'google',
    connectionId: 'conn-1',
    emailAddress: 'rep@example.com',
    ...overrides,
  }
}

const OUTBOUND = {
  to: [{ email: 'client@example.com' }],
  subject: 'Quarterly review',
  bodyHtml: '<p>Hello</p>',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMailProvider — the switch on provider', () => {
  it('scopes the lookup to (id, orgId)', async () => {
    mailAccount.findFirst.mockResolvedValue(mailboxRow())

    await getMailProvider('box-1', ORG_ID)

    expect(mailAccount.findFirst).toHaveBeenCalledTimes(1)
    expect(mailAccount.findFirst.mock.calls[0][0].where).toEqual({ id: 'box-1', orgId: ORG_ID })
  })

  it('returns the Google implementation, and its sendEmail works against the mock', async () => {
    mailAccount.findFirst.mockResolvedValue(mailboxRow({ provider: 'google' }))

    const provider = await getMailProvider('box-1', ORG_ID)
    expect(provider.provider).toBe('google')

    const sent = await provider.sendEmail(OUTBOUND)
    expect(sent.providerMsgId).toBe('gmail-msg-1')
    expect(sent.threadId).toBe('gmail-thread-1')
    // sentAt is the provider's own instant, read back from internalDate — not a local now().
    expect(sent.sentAt.getTime()).toBe(Number(GMAIL_INTERNAL_DATE))
  })

  it('returns the Microsoft implementation, and its sendEmail works against the mock', async () => {
    mailAccount.findFirst.mockResolvedValue(mailboxRow({ provider: 'microsoft' }))

    const provider = await getMailProvider('box-1', ORG_ID)
    expect(provider.provider).toBe('microsoft')

    const sent = await provider.sendEmail(OUTBOUND)
    expect(sent.providerMsgId).toBe('graph-msg-1')
    expect(sent.threadId).toBe('graph-conv-1')
    expect(sent.sentAt.getTime()).toBe(new Date(GRAPH_SENT_DATE).getTime())
  })

  it('throws MailboxNotFoundError for a deleted mailbox (no row for this id/org)', async () => {
    mailAccount.findFirst.mockResolvedValue(null)

    await expect(getMailProvider('deleted-box', ORG_ID)).rejects.toBeInstanceOf(MailboxNotFoundError)
  })

  it("throws MailboxNotFoundError for another org's mailbox, not a leak", async () => {
    // The row exists, but not for OTHER_ORG_ID, so the org-scoped findFirst returns
    // null — indistinguishable from a deleted mailbox, by design.
    mailAccount.findFirst.mockImplementation(async ({ where }: { where: { orgId: string } }) =>
      where.orgId === ORG_ID ? mailboxRow() : null,
    )

    await expect(getMailProvider('box-1', OTHER_ORG_ID)).rejects.toBeInstanceOf(MailboxNotFoundError)
    // And the same id in its OWN org still resolves — proving the miss was the org, not the id.
    await expect(getMailProvider('box-1', ORG_ID)).resolves.toBeDefined()
  })

  it('throws MailApiError for a provider string with no implementation', async () => {
    // A provider the database holds but the seam has no case for is a bug in
    // int-oauth, surfaced loud rather than degraded around.
    mailAccount.findFirst.mockResolvedValue(mailboxRow({ provider: 'yahoo' }))

    await expect(getMailProvider('box-1', ORG_ID)).rejects.toBeInstanceOf(MailApiError)
  })
})
