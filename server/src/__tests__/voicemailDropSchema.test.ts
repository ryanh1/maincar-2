import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(path.resolve(import.meta.dirname, '../../prisma/schema.prisma'), 'utf8')
const migrationsDir = path.resolve(import.meta.dirname, '../../prisma/migrations')

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`)
  expect(start, `model ${name} is missing from schema.prisma`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end)
}

function fieldLine(block: string, field: string): string {
  const line = block
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value === field || value.startsWith(`${field} `))
  expect(line, `field "${field}" is missing`).toBeDefined()
  return line!.replace(/\s+/g, ' ')
}

function voicemailDropMigration(): string {
  const directory = readdirSync(migrationsDir).find((entry) => entry.endsWith('_add_voicemail_drop_schema'))
  expect(directory, 'VoicemailDrop migration is missing').toBeDefined()
  return readFileSync(path.join(migrationsDir, directory!, 'migration.sql'), 'utf8')
}

describe('VoicemailDrop schema', () => {
  const drops = modelBlock('VoicemailDrop')

  it('stores every field in the reusable pre-recorded drops library', () => {
    const expected: Record<string, string> = {
      id: 'String',
      orgId: 'String',
      name: 'String',
      audioUrl: 'String',
      duration: 'Int',
      isDefault: 'Boolean',
      transcript: 'String?',
      transcriptStatus: 'String',
      createdAt: 'DateTime',
      updatedAt: 'DateTime',
    }

    for (const [field, type] of Object.entries(expected)) {
      expect(fieldLine(drops, field).split(' ')[1], `${field} has the wrong type`).toBe(type)
    }
  })

  it('belongs to exactly one organization and is reachable from it', () => {
    expect(fieldLine(drops, 'org')).toBe(
      'org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)',
    )
    expect(modelBlock('Org')).toMatch(/voicemailDrops\s+VoicemailDrop\[\]/)
    expect(drops).toContain('@@index([orgId, name])')
  })

  it('starts non-default and leaves the transcript pending until it is produced', () => {
    expect(fieldLine(drops, 'isDefault')).toBe('isDefault Boolean @default(false)')
    expect(fieldLine(drops, 'transcriptStatus')).toBe('transcriptStatus String @default("pending")')
  })

  it('creates a database-enforced one-default-per-org partial unique index', () => {
    const migration = voicemailDropMigration()
    expect(migration).toContain('CREATE UNIQUE INDEX "VoicemailDrop_one_default_per_org"')
    expect(migration).toContain('ON "VoicemailDrop"("orgId") WHERE "isDefault"')
  })
})
