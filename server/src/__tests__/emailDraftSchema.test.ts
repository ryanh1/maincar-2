// The EmailDraft model's contract, read straight off prisma/schema.prisma.
//
// This is the UNIT-suite half — it needs no database, so it runs on every
// commit. The real Postgres behaviour (defaults, cascades, the index actually
// existing) is proved in emailDraft.integration.test.ts.
//
// What it guards is the set of decisions that are easy to undo by accident:
// two dock flags instead of one, the dock's composite index, cascade from both
// parents, and `mailAccountId` / `recordId` staying bare Strings while the
// tables they will one day point at do not exist yet.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(
  path.resolve(import.meta.dirname, '../../prisma/schema.prisma'),
  'utf8',
)

/** The text between `model EmailDraft {` and its closing brace. */
function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`)
  expect(start, `model ${name} is missing from schema.prisma`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end)
}

const emailDraft = modelBlock('EmailDraft')
const savedStateMigration = readFileSync(
  path.resolve(import.meta.dirname, '../../prisma/migrations/20260822050000_simplify_email_draft_saved_state/migration.sql'),
  'utf8',
)

/** The one line that declares a field, whitespace collapsed. */
function fieldLine(block: string, field: string): string {
  const line = block
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l === field || l.startsWith(`${field} `))
  expect(line, `field "${field}" is missing`).toBeDefined()
  return line!.replace(/\s+/g, ' ')
}

describe('EmailDraft schema', () => {
  it('stores every column the dock reads and writes', () => {
    const expected: Record<string, string> = {
      id: 'String',
      orgId: 'String',
      userId: 'String',
      mailAccountId: 'String?',
      recordId: 'String?',
      toAddrs: 'String[]',
      ccAddrs: 'String[]',
      bccAddrs: 'String[]',
      subject: 'String?',
      bodyHtml: 'String?',
      isOpen: 'Boolean',
      createdAt: 'DateTime',
      updatedAt: 'DateTime',
    }

    for (const [field, type] of Object.entries(expected)) {
      expect(fieldLine(emailDraft, field).split(' ')[1], `${field} has the wrong type`).toBe(type)
    }
  })

  it('opens a new card as visible', () => {
    expect(fieldLine(emailDraft, 'isOpen')).toContain('@default(true)')
  })

  it('documents that putting a draft away keeps it', () => {
    expect(emailDraft).toContain('put away but kept')
    expect(emailDraft).toContain('Discarding is a DELETE')
  })

  it('preserves legacy minimized drafts as saved before dropping their old field', () => {
    expect(savedStateMigration).toMatch(/UPDATE "EmailDraft"\s+SET "isOpen" = false\s+WHERE "isMinimized" = true;/)
    expect(savedStateMigration.indexOf('UPDATE "EmailDraft"')).toBeLessThan(
      savedStateMigration.indexOf('DROP COLUMN "isMinimized"'),
    )
  })

  it('indexes the dock’s only query', () => {
    expect(emailDraft).toContain('@@index([orgId, userId, updatedAt])')
  })

  it('cascades from both parents', () => {
    expect(fieldLine(emailDraft, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
    expect(fieldLine(emailDraft, 'user')).toBe(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
    )
  })

  it('keeps mailAccountId and recordId as bare Strings, not relations', () => {
    // Neither MailAccount nor the CRM record table exists yet. A relation here
    // would not compile, and a foreign key would block writing the id the
    // composer already knows.
    expect(fieldLine(emailDraft, 'mailAccountId')).toBe('mailAccountId String?')
    expect(fieldLine(emailDraft, 'recordId')).toBe('recordId String?')
  })

  it('is reachable from Org and User', () => {
    expect(modelBlock('Org')).toMatch(/emailDrafts\s+EmailDraft\[]/)
    expect(modelBlock('User')).toMatch(/emailDrafts\s+EmailDraft\[]/)
  })
})
