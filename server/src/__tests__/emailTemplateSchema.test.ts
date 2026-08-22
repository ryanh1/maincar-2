// The EmailTemplate model's contract, read straight off prisma/schema.prisma.
//
// This is the UNIT-suite half — it needs no database, so it runs on every
// commit. The real Postgres behaviour (defaults, the index actually existing,
// what happens to a template when its author is deleted) is proved in
// emailTemplate.integration.test.ts.
//
// What it guards is the visibility boundary: templates begin private, and an
// author can choose to share one with their organization.
import { readFileSync, readdirSync } from 'node:fs'
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

const emailTemplate = modelBlock('EmailTemplate')
const migrationsDir = path.resolve(import.meta.dirname, '../../prisma/migrations')

function visibilityMigration(): string {
  const directory = readdirSync(migrationsDir).find((entry) => entry.endsWith('_add_email_template_visibility'))
  expect(directory, 'email template visibility migration is missing').toBeDefined()
  return readFileSync(path.join(migrationsDir, directory!, 'migration.sql'), 'utf8')
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

describe('EmailTemplate schema', () => {
  it('stores every column the Templates screen reads and writes', () => {
    const expected: Record<string, string> = {
      id: 'String',
      orgId: 'String',
      createdById: 'String?',
      name: 'String',
      subject: 'String',
      bodyHtml: 'String',
      visibility: 'EmailTemplateVisibility',
      fieldsJson: 'Json?',
      createdAt: 'DateTime',
      updatedAt: 'DateTime',
    }

    for (const [field, type] of Object.entries(expected)) {
      expect(fieldLine(emailTemplate, field).split(' ')[1], `${field} has the wrong type`).toBe(type)
    }
  })

  it('requires a name, a subject, and a body — none of the three is optional', () => {
    // A template with no name cannot be picked out of the dropdown, and one with
    // no subject or body inserts nothing. All three are NOT NULL on purpose.
    for (const field of ['name', 'subject', 'bodyHtml']) {
      expect(fieldLine(emailTemplate, field), `${field} must not be optional`).not.toContain('?')
    }
  })

  it('has explicit visibility and starts new templates private', () => {
    expect(schema).toMatch(/enum EmailTemplateVisibility \{\s+PRIVATE\s+ORGANIZATION\s+\}/s)
    expect(fieldLine(emailTemplate, 'visibility')).toBe('visibility EmailTemplateVisibility @default(PRIVATE)')
  })

  it('migrates existing templates to organization visibility before defaulting new rows private', () => {
    const migration = visibilityMigration()
    expect(migration).toContain("ADD COLUMN \"visibility\" \"EmailTemplateVisibility\" NOT NULL DEFAULT 'ORGANIZATION'")
    expect(migration).toContain('ALTER COLUMN "visibility" SET DEFAULT \'PRIVATE\'')
  })

  it('is organization-scoped, with private ownership recorded through createdById', () => {
    expect(fieldLine(emailTemplate, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
  })

  it('documents the private and organization visibility model beside the schema', () => {
    const preamble = schema.slice(
      schema.lastIndexOf('\n\n', schema.indexOf('model EmailTemplate {')),
      schema.indexOf('model EmailTemplate {'),
    )
    expect(preamble).toContain('starts')
    expect(preamble).toContain('private')
    expect(preamble).toContain('organization')
  })

  it('keeps the template when its author leaves — nullable createdById, SetNull', () => {
    // Attribution, never a filter. Cascade would delete the team's templates
    // along with the rep who wrote them, and the Prisma default (Restrict) would
    // make that rep undeletable. Invitation.invitedByUser does the same thing.
    expect(fieldLine(emailTemplate, 'createdBy')).toBe(
      'createdBy User? @relation(fields: [createdById], references: [id], onDelete: SetNull)',
    )
  })

  it('marks fieldsJson as derived, null for now, and never authoritative', () => {
    // fieldsJson is a cache of what the text already says. If a reader ever
    // treats it as the source of truth, an edited body and a stale field list
    // disagree and the list wins — exactly backwards.
    expect(emailTemplate).toContain('DERIVED data, never')
    expect(emailTemplate).toContain('the TEXT WINS')
    expect(emailTemplate).toContain('a client-supplied value is ignored')
    expect(emailTemplate).toContain('null until merge fields land')
  })

  it('indexes the Templates screen’s organization query', () => {
    expect(emailTemplate).toContain('@@index([orgId, name])')
  })

  it('is reachable from Org and User', () => {
    expect(modelBlock('Org')).toMatch(/emailTemplates\s+EmailTemplate\[]/)
    expect(modelBlock('User')).toMatch(/emailTemplates\s+EmailTemplate\[]/)
  })
})
