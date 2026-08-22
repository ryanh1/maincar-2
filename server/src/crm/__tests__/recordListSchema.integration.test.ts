// The generic list compiler uses raw SQL, so this verifies its table mappings
// against a clean Postgres schema created by replaying every checked-in migration.
import { afterAll, describe, expect, it } from 'vitest'

import { TABLE_STORAGE_LIST_CONTRACT } from '../recordList.js'
import { createTestPrisma } from '../../test/integration/testPrisma.js'

const prisma = createTestPrisma()

afterAll(async () => {
  await prisma.$disconnect()
})

describe('recordList table-storage migration contract', () => {
  it('creates every raw-query list column for every registered table mapping', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `
    const columnsByTable = new Map<string, Set<string>>()
    for (const row of rows) {
      const columns = columnsByTable.get(row.table_name) ?? new Set<string>()
      columns.add(row.column_name)
      columnsByTable.set(row.table_name, columns)
    }

    for (const [objectSlug, { tableName, requiredColumns }] of Object.entries(TABLE_STORAGE_LIST_CONTRACT)) {
      const columns = columnsByTable.get(tableName) ?? new Set<string>()
      for (const column of requiredColumns) {
        expect(columns, `${objectSlug} list mapping requires migrated ${tableName}.${column.name}`).toContain(column.name)
      }
    }
  })
})
