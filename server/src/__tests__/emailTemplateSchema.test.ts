// The EmailTemplate model's contract, read straight off prisma/schema.prisma.
//
// This is the UNIT-suite half — it needs no database, so it runs on every
// commit. The real Postgres behaviour (defaults, the index actually existing,
// what happens to a template when its author is deleted) is proved in
// emailTemplate.integration.test.ts.
//
// What it guards is the one decision the whole module turns on: a template is
// ORG-WIDE, not private to its author (SPEC-composer-templates.md § Acceptance
// criteria 2). EmailDraft, right above it in the schema, is the opposite — org-
// AND user-scoped. The two models sit next to each other and read almost alike,
// so the way this gets broken is someone copying the draft's userId scoping down
// into the template and turning every teammate's template into a note to self.
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

const emailTemplate = modelBlock('EmailTemplate')

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

  it('is org-scoped ONLY — no userId column to filter a teammate out', () => {
    // The whole point of the module. EmailDraft carries `userId String` and
    // filters on it; EmailTemplate must not, or the org-wide list silently
    // becomes a per-rep list. Per-user private templates are an "ask first" in
    // the spec's Boundaries.
    expect(modelBlock('EmailDraft')).toMatch(/^\s*userId\s+String\s*$/m)
    expect(emailTemplate).not.toMatch(/^\s*userId\s/m)
    expect(fieldLine(emailTemplate, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
  })

  it('says in the schema that templates are org-wide, not private', () => {
    // The comment above the model is the only place the decision is written
    // down next to the code that implements it. Losing it is how EC-17's query
    // filters quietly grow a userId.
    const preamble = schema.slice(
      schema.lastIndexOf('\n\n', schema.indexOf('model EmailTemplate {')),
      schema.indexOf('model EmailTemplate {'),
    )
    expect(preamble).toContain('Org-wide, NOT private to its author')
    expect(preamble).toContain('every query filters on orgId')
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

  it('indexes the Templates screen’s only query', () => {
    expect(emailTemplate).toContain('@@index([orgId, name])')
  })

  it('is reachable from Org and User', () => {
    expect(modelBlock('Org')).toMatch(/emailTemplates\s+EmailTemplate\[]/)
    expect(modelBlock('User')).toMatch(/emailTemplates\s+EmailTemplate\[]/)
  })
})
