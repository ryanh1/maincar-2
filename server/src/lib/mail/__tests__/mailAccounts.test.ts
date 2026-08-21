// Unit tests for mailAccounts.ts and the typed error set in mailErrors.ts.
//
// What these protect:
//   - the first mailbox a rep connects is primary; a later one is not
//   - re-upserting the same address updates the one row rather than duplicating it,
//     and never clobbers isPrimary or a display name the rep set
//   - setPrimaryMailbox clears and sets inside ONE $transaction, in that order
//   - a mailbox id from another rep returns null rather than a leaky error
//   - every mail error carries its stable `name`, and RateLimitedError its retryAfterMs
//
// The atomic guarantee under real concurrency — two switches never leave two
// primaries or none — is proven against real Postgres in
// src/__tests__/mailAccounts.integration.test.ts. Here prisma is mocked, and the
// interactive $transaction is invoked with a `tx` that IS the mailAccount mock, so
// these assert the SHAPE of the calls the transaction makes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, mailAccount } = vi.hoisted(() => {
  const mailAccount = {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  }
  return {
    mailAccount,
    prismaMock: {
      mailAccount,
      // The interactive form: run the callback with the same mailAccount mock as tx.
      $transaction: vi.fn(async (cb: (tx: { mailAccount: typeof mailAccount }) => unknown) =>
        cb({ mailAccount }),
      ),
    },
  }
})

vi.mock('../../../db.js', () => ({ default: prismaMock }))

import {
  CursorExpiredError,
  MailApiError,
  MailAuthError,
  MailboxNotFoundError,
  RateLimitedError,
} from '../mailErrors.js'
import { setPrimaryMailbox, upsertMailAccount } from '../mailAccounts.js'

const ORG_ID = 'org-a'
const USER_ID = 'user-a'
const CONN_ID = 'conn-1'

function mailboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'box-1',
    orgId: ORG_ID,
    userId: USER_ID,
    connectionId: CONN_ID,
    provider: 'google',
    emailAddress: 'rep@example.com',
    displayName: null,
    isPrimary: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mailAccount.updateMany.mockResolvedValue({ count: 1 })
})

describe('upsertMailAccount', () => {
  it('makes the FIRST mailbox for a rep primary', async () => {
    mailAccount.findFirst.mockResolvedValue(null) // address not seen before
    mailAccount.count.mockResolvedValue(0) // rep has no mailbox yet
    mailAccount.create.mockResolvedValue(mailboxRow({ isPrimary: true }))

    await upsertMailAccount({
      orgId: ORG_ID,
      userId: USER_ID,
      connectionId: CONN_ID,
      provider: 'google',
      emailAddress: 'rep@example.com',
    })

    expect(mailAccount.create).toHaveBeenCalledTimes(1)
    expect(mailAccount.create.mock.calls[0][0].data.isPrimary).toBe(true)
  })

  it('does NOT make a second mailbox primary', async () => {
    mailAccount.findFirst.mockResolvedValue(null)
    mailAccount.count.mockResolvedValue(1) // the rep already has one
    mailAccount.create.mockResolvedValue(mailboxRow({ isPrimary: false }))

    await upsertMailAccount({
      orgId: ORG_ID,
      userId: USER_ID,
      connectionId: 'conn-2',
      provider: 'microsoft',
      emailAddress: 'second@example.com',
    })

    expect(mailAccount.create.mock.calls[0][0].data.isPrimary).toBe(false)
  })

  it('updates the existing row for a known address instead of creating a second', async () => {
    mailAccount.findFirst.mockResolvedValue({ id: 'box-1' }) // address already present
    mailAccount.findFirstOrThrow.mockResolvedValue(mailboxRow())

    await upsertMailAccount({
      orgId: ORG_ID,
      userId: USER_ID,
      connectionId: CONN_ID,
      provider: 'google',
      emailAddress: 'rep@example.com',
    })

    expect(mailAccount.create).not.toHaveBeenCalled()
    expect(mailAccount.updateMany).toHaveBeenCalledTimes(1)
    const call = mailAccount.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ orgId: ORG_ID, emailAddress: 'rep@example.com' })
    // isPrimary is never in a reconnect's update — the rep's choice survives.
    expect(call.data).not.toHaveProperty('isPrimary')
    // No displayName was passed, so a name the rep set is not wiped.
    expect(call.data).not.toHaveProperty('displayName')
  })

  it('writes displayName on reconnect only when one is supplied', async () => {
    mailAccount.findFirst.mockResolvedValue({ id: 'box-1' })
    mailAccount.findFirstOrThrow.mockResolvedValue(mailboxRow({ displayName: 'Work' }))

    await upsertMailAccount({
      orgId: ORG_ID,
      userId: USER_ID,
      connectionId: CONN_ID,
      provider: 'google',
      emailAddress: 'rep@example.com',
      displayName: 'Work',
    })

    expect(mailAccount.updateMany.mock.calls[0][0].data.displayName).toBe('Work')
  })
})

describe('setPrimaryMailbox', () => {
  it('clears every mailbox then sets the target, inside one transaction', async () => {
    mailAccount.findFirst.mockResolvedValue({ id: 'box-2' })
    mailAccount.findMany.mockResolvedValue([
      mailboxRow({ id: 'box-1', isPrimary: false }),
      mailboxRow({ id: 'box-2', isPrimary: true }),
    ])

    const result = await setPrimaryMailbox('box-2', ORG_ID, USER_ID)

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(mailAccount.updateMany).toHaveBeenCalledTimes(2)

    // First call clears the whole set for this rep...
    const clear = mailAccount.updateMany.mock.calls[0][0]
    expect(clear.where).toEqual({ orgId: ORG_ID, userId: USER_ID })
    expect(clear.data).toEqual({ isPrimary: false })

    // ...then the second sets the one target, scoped to (id, orgId, userId).
    const set = mailAccount.updateMany.mock.calls[1][0]
    expect(set.where).toEqual({ id: 'box-2', orgId: ORG_ID, userId: USER_ID })
    expect(set.data).toEqual({ isPrimary: true })

    // Exactly one primary comes back in the returned set.
    expect(result?.filter((b) => b.isPrimary)).toHaveLength(1)
  })

  it('returns null and writes nothing for a mailbox id that is not this rep’s', async () => {
    mailAccount.findFirst.mockResolvedValue(null) // no such mailbox for (orgId, userId)

    const result = await setPrimaryMailbox('box-other-org', ORG_ID, USER_ID)

    expect(result).toBeNull()
    expect(mailAccount.updateMany).not.toHaveBeenCalled()
  })
})

describe('mailErrors — the typed set', () => {
  it('each error carries its stable name', () => {
    expect(new MailApiError().name).toBe('MailApiError')
    expect(new MailboxNotFoundError().name).toBe('MailboxNotFoundError')
    expect(new MailAuthError().name).toBe('MailAuthError')
    expect(new CursorExpiredError().name).toBe('CursorExpiredError')
    expect(new RateLimitedError(1000).name).toBe('RateLimitedError')
  })

  it('every error is an Error, and instanceof distinguishes them', () => {
    const auth = new MailAuthError()
    expect(auth).toBeInstanceOf(Error)
    expect(auth).toBeInstanceOf(MailAuthError)
    // A MailAuthError is NOT a MailApiError — the set does not collapse into one.
    expect(auth).not.toBeInstanceOf(MailApiError)
  })

  it('RateLimitedError carries the retry-after it was given', () => {
    expect(new RateLimitedError(2500).retryAfterMs).toBe(2500)
  })
})
