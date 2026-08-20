import { defineConfig } from 'vitest/config'

// The INTEGRATION suite: real Postgres, a uniquely-named schema per run.
//
// It is a separate vitest project from vitest.config.ts on purpose:
//   - it matches only *.integration.test.ts
//   - its setup does NOT mock Prisma, so these tests exercise the real client,
//     the real columns, and the real constraints
//   - a globalSetup creates the schema and runs `prisma migrate deploy` into it
//     once, then drops it on teardown
//
// A schema rather than a whole database: it needs no CREATE DATABASE privilege,
// it is fast, and `DROP SCHEMA ... CASCADE` is a total, reliable reset.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['src/test/integration/globalSetup.ts'],
    setupFiles: ['src/test/integration/setup.ts'],
    // One schema, one connection pool. A single worker with no parallel files, so
    // tests share the schema globalSetup made without racing each other.
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
    // Migrations and round trips are slower than unit tests.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
