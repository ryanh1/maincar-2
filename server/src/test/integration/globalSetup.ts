// Runs once per `npm run test:integration`, before any test file loads.
//
//   1. Create a fresh, uniquely-named schema.
//   2. Run `prisma migrate deploy` ONCE into it.
//   3. Hand the schema URL and name to the workers via vitest's provide/inject.
//   4. On teardown, DROP only that schema.
//
// A schema, not a database: no CREATE DATABASE privilege needed, fast, and the
// cascading drop is a guaranteed clean reset.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

// dotenv never overrides an already-set var, so this is safe beside config.ts.
loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env') })

/** The same connection, aimed at a named schema. */
function withSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('schema', schema)
  return url.toString()
}

/** The same connection with NO schema param — used to CREATE and DROP schemas. */
function adminUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.searchParams.delete('schema')
  return url.toString()
}

function uniqueSchemaName(): string {
  // Timestamp plus randomness, so two runs started in the same second still get
  // distinct schemas.
  const rand = Math.random().toString(36).slice(2, 8)
  return `test_${Date.now()}_${rand}`
}

async function migrateSchema(schemaUrl: string, schema: string): Promise<void> {
  const migrationsDir = path.resolve(import.meta.dirname, '../../../prisma/migrations')
  const migrations = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const client = new Client({ connectionString: schemaUrl })
  await client.connect()
  try {
    await client.query(`SET search_path TO "${schema}"`)
    for (const migration of migrations) {
      await client.query(await readFile(path.join(migrationsDir, migration, 'migration.sql'), 'utf8'))
    }
    const result = await client.query<{ table: string | null }>(
      "SELECT to_regclass(current_schema() || '.\"Org\"') AS table",
    )
    if (!result.rows[0]?.table) throw new Error(`Integration schema ${schema} has no Org table after migrations.`)
  } finally {
    await client.end()
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl) {
    throw new Error(
      'Integration tests need DATABASE_URL (repo-root .env) pointing at a local Postgres. ' +
        'Start it with `npm run docker:up`.',
    )
  }

  const schema = uniqueSchemaName()
  const schemaUrl = withSchema(baseUrl, schema)
  const admin = adminUrl(baseUrl)

  const adminClient = new Client({ connectionString: admin })
  await adminClient.connect()
  try {
    // Never sweep every `test_*` schema here: another integration run may be
    // actively using one. This run owns and removes only its unique schema in
    // its teardown; a crashed run's leftover is harmless and can be inspected
    // or cleaned by coordination tooling outside a live test run.
    await adminClient.query(`CREATE SCHEMA "${schema}"`)
  } finally {
    await adminClient.end()
  }

  await migrateSchema(schemaUrl, schema)

  project.provide('testDatabaseUrl', schemaUrl)
  project.provide('testSchema', schema)

  return async () => {
    const cleanup = new Client({ connectionString: admin })
    await cleanup.connect()
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await cleanup.end()
    }
  }
}
