import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { TABLE_STORAGE_LIST_CONTRACT } from '../recordList.js'

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
    for (const [objectSlug, { tableName, requiredColumns }] of Object.entries(TABLE_STORAGE_LIST_CONTRACT)) {
      const model = modelBlock(tableName)
      for (const column of requiredColumns) {
        expect(model, `${objectSlug} list mapping requires ${tableName}.${column.name}`).toMatch(
          new RegExp(`\\n\\s*${column.name}\\s+${column.prismaType}\\b`),
        )
      }
    }
  })
})
