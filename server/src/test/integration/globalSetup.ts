// Runs once per `npm run test:integration`, before any test file loads.
//
//   1. Sweep any `test_*` schemas left behind by a crashed run.
//   2. Create a fresh, uniquely-named schema.
//   3. Run `prisma migrate deploy` ONCE into it.
//   4. Hand the schema URL and name to the workers via vitest's provide/inject.
//   5. On teardown, DROP SCHEMA ... CASCADE.
//
// A schema, not a database: no CREATE DATABASE privilege needed, fast, and the
// cascading drop is a guaranteed clean reset.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

const execFileAsync = promisify(execFile)

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
    // The `\_` escapes LIKE's wildcard, so only the literal "test_" prefix
    // matches — a schema called "testing" is left alone.
    const leftovers = await adminClient.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test\\_%' ESCAPE '\\'",
    )
    for (const row of leftovers.rows) {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`)
    }

    await adminClient.query(`CREATE SCHEMA "${schema}"`)
  } finally {
    await adminClient.end()
  }

  // Migrate ONCE, via the Prisma CLI. BOTH URLs are overridden: prisma.config.ts
  // sets a directUrl, and for migration commands directUrl wins — leave it and
  // the migration lands in the developer's real database instead.
  const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma')
  await execFileAsync(prismaBin, ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: schemaUrl, DIRECT_DATABASE_URL: schemaUrl },
  })

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
