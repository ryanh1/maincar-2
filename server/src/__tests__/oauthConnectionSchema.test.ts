// The OAuthConnection and MailAccount contract, read straight off
// prisma/schema.prisma.
//
// This is the UNIT-suite half — it needs no database, so it runs on every
// commit. The real Postgres behaviour (defaults, uniques, cascades, the indexes
// actually existing) is proved in oauthConnection.integration.test.ts.
//
// What it guards is the set of decisions that are easy to undo by accident:
// the token fields staying `@db.Text` with the never-logged comment, provider
// and status staying plain Strings (no Prisma enum), the identity/address unique
// keys that make reconnecting an update rather than a duplicate, and the cascades
// that stop a deleted org, user, or grant leaving orphans behind.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(
  path.resolve(import.meta.dirname, '../../prisma/schema.prisma'),
  'utf8',
)

/** The text between `model X {` and its closing brace. */
function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`)
  expect(start, `model ${name} is missing from schema.prisma`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end)
}

/** The one line that declares a field, whitespace collapsed. */
function fieldLine(block: string, field: string): string {
  const line = block
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l === field || l.startsWith(`${field} `))
  expect(line, `field "${field}" is missing`).toBeDefined()
  return line!.replace(/\s+/g, ' ')
}

const connection = modelBlock('OAuthConnection')
const mailAccount = modelBlock('MailAccount')

describe('OAuthConnection schema', () => {
  it('stores every column the grant and its honest status need', () => {
    const expected: Record<string, string> = {
      id: 'String',
      orgId: 'String',
      userId: 'String',
      provider: 'String',
      providerAccountId: 'String',
      emailAddress: 'String',
      refreshToken: 'String',
      accessToken: 'String?',
      expiresAt: 'DateTime?',
      scopes: 'String[]',
      status: 'String',
      errorCode: 'String?',
      statusDetail: 'String?',
      lastValidatedAt: 'DateTime?',
      lastRefreshAt: 'DateTime?',
      createdAt: 'DateTime',
      updatedAt: 'DateTime',
    }

    for (const [field, type] of Object.entries(expected)) {
      expect(fieldLine(connection, field).split(' ')[1], `${field} has the wrong type`).toBe(type)
    }
  })

  it('holds the tokens as large text, never as bounded columns', () => {
    expect(fieldLine(connection, 'refreshToken')).toContain('@db.Text')
    expect(fieldLine(connection, 'accessToken')).toContain('@db.Text')
  })

  it('is born connected with no scopes granted yet', () => {
    expect(fieldLine(connection, 'status')).toContain('@default("connected")')
    expect(fieldLine(connection, 'scopes')).toContain('@default([])')
  })

  it('keeps provider and status as plain Strings, never a Prisma enum', () => {
    // A Postgres enum needs an ALTER TYPE dance to add a value; a String just
    // changes. The allowed values live in a comment beside each field.
    expect(fieldLine(connection, 'provider').split(' ')[1]).toBe('String')
    expect(fieldLine(connection, 'status').split(' ')[1]).toBe('String')
    expect(schema).not.toMatch(/\benum\s+\w+\s*\{/)
    expect(connection).toMatch(/google \| microsoft/)
    expect(connection).toMatch(/connected \| limited \| error/)
  })

  it('warns, in the schema itself, that tokens never leave the server', () => {
    // The comment is the only place the rule is written down next to the fields
    // it governs. Losing it is how the next reader logs or returns a token.
    expect(connection).toContain('Never logged, never')
    expect(connection).toContain('never in a response body')
  })

  it('allows multiple provider accounts while reconnecting one identity updates', () => {
    expect(connection).toContain('@@unique([orgId, userId, provider, providerAccountId])')
  })

  it('indexes the tenant lookup', () => {
    expect(connection).toContain('@@index([orgId, userId])')
  })

  it('cascades from both parents', () => {
    expect(fieldLine(connection, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
    expect(fieldLine(connection, 'user')).toBe(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
    )
  })
})

describe('MailAccount schema', () => {
  it('stores every column the mailbox list reads', () => {
    const expected: Record<string, string> = {
      id: 'String',
      orgId: 'String',
      userId: 'String',
      connectionId: 'String',
      provider: 'String',
      emailAddress: 'String',
      displayName: 'String?',
      isPrimary: 'Boolean',
      createdAt: 'DateTime',
      updatedAt: 'DateTime',
    }

    for (const [field, type] of Object.entries(expected)) {
      expect(fieldLine(mailAccount, field).split(' ')[1], `${field} has the wrong type`).toBe(type)
    }
  })

  it('is born non-primary — the primary flag is set deliberately, never by default', () => {
    expect(fieldLine(mailAccount, 'isPrimary')).toContain('@default(false)')
  })

  it('binds exactly one mailbox to a connection, and cascades when the grant goes', () => {
    // @unique makes MailAccount.connection a one-to-one; Cascade means deleting
    // the grant deletes the mailbox — a mailbox with no token cannot send.
    expect(fieldLine(mailAccount, 'connectionId')).toContain('@unique')
    expect(fieldLine(mailAccount, 'connection')).toBe(
      'connection OAuthConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)',
    )
  })

  it('allows one mailbox per address per org — reconnecting updates', () => {
    expect(mailAccount).toContain('@@unique([orgId, emailAddress])')
  })

  it('indexes the tenant lookup', () => {
    expect(mailAccount).toContain('@@index([orgId, userId])')
  })

  it('cascades from both parents', () => {
    expect(fieldLine(mailAccount, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
    expect(fieldLine(mailAccount, 'user')).toBe(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
    )
  })
})

describe('back-relations', () => {
  it('reaches both models from Org and from User', () => {
    for (const parent of ['Org', 'User']) {
      const block = modelBlock(parent)
      expect(block, `${parent} is missing oauthConnections`).toMatch(
        /oauthConnections\s+OAuthConnection\[]/,
      )
      expect(block, `${parent} is missing mailAccounts`).toMatch(/mailAccounts\s+MailAccount\[]/)
    }
  })
})
