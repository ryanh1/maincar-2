import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Run the suite in UTC, always. Without this a test picks up whatever zone the
// machine is in, so a timezone assumption passes locally and fails in CI. UTC is
// arbitrary; being the SAME everywhere is the point. A test that cares about a
// zone must set it explicitly rather than inherit one.
process.env.TZ = 'UTC'

// Kept separate from vite.config.ts so the dev/build config stays about the app.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    css: false,
  },
})
