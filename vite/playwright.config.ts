import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.browser.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5192',
    browserName: 'chromium',
    viewport: { width: 1024, height: 768 },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5192',
    env: {
      // Browser fixtures make real jsonFetch calls but do not sign in. A safe
      // config lets Firebase initialize without borrowing a developer's .env.
      VITE_FIREBASE_CONFIG: '{"apiKey":"fixture-api-key","authDomain":"fixture.invalid","projectId":"fixture"}',
      VITE_ENVIRONMENT: 'production',
      VITE_DISABLE_API_LOGGING: 'true',
    },
    url: 'http://127.0.0.1:5192/__fixtures/audio-player',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
