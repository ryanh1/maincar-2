import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(path.resolve(import.meta.dirname, '../../prisma/schema.prisma'), 'utf8')

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

describe('EmailSignature schema', () => {
  const signatures = modelBlock('EmailSignature')

  it('keeps every signature private to its owner', () => {
    expect(fieldLine(signatures, 'userId')).toBe('userId String')
    expect(fieldLine(signatures, 'user')).toBe(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
    )
    expect(signatures).not.toMatch(/^\s*orgId\s/m)
    expect(modelBlock('User')).toMatch(/emailSignatures\s+EmailSignature\[\]/)
  })

  it('stores a pickable name and sanitized rich-text body', () => {
    expect(fieldLine(signatures, 'name')).toBe('name String')
    expect(fieldLine(signatures, 'bodyHtml')).toBe('bodyHtml String')
  })

  it('allows only one default signature for a user', () => {
    expect(fieldLine(signatures, 'isDefault')).toBe('isDefault Boolean @default(false)')
    expect(fieldLine(signatures, 'defaultForUser')).toBe('defaultForUser String? @unique')
  })

  it('indexes the settings and composer list by owner and name', () => {
    expect(signatures).toContain('@@index([userId, name])')
  })
})
