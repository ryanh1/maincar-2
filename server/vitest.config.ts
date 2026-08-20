import { defineConfig, configDefaults } from 'vitest/config'

// The UNIT suite. It never touches a database: each test file mocks `../../db.js`
// itself. Integration tests run under vitest.integration.config.ts against a real
// Postgres, and are excluded here so they cannot be pulled in by accident.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // One worker, no parallel files. These tests are fast, and running them in
    // sequence keeps the output ordered and makes a hang easy to attribute.
    // (Vitest 4 replaced poolOptions.threads.singleThread with maxWorkers.)
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
