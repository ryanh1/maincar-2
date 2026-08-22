import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { TABLE_STORAGE_TABLES } from '../recordList.js'

const schema = readFileSync(path.resolve(import.meta.dirname, '../../../prisma/schema.prisma'), 'utf8')

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`)
  expect(start, `Prisma model ${name} is missing`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n}', start)
  expect(end, `Prisma model ${name} has no closing brace`).toBeGreaterThan(start)
  return schema.slice(start, end)
}

describe('recordList table-storage schema contract', () => {
  it('requires every raw-query table to provide its selected and filtered columns', () => {
    for (const tableName of Object.values(TABLE_STORAGE_TABLES)) {
      const model = modelBlock(tableName)
      expect(model).toMatch(/\n\s*id\s+String\s+@id\b/)
      expect(model).toMatch(/\n\s*orgId\s+String\b/)
      expect(model).toMatch(/\n\s*customJson\s+Json\b/)
      expect(model).toMatch(/\n\s*deletedAt\s+DateTime\?/)
      expect(model).toMatch(/\n\s*createdAt\s+DateTime\b/)
      expect(model).toMatch(/\n\s*updatedAt\s+DateTime\b/)
    }
  })
})
