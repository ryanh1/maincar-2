import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5192)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.browser.spec.ts',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1024, height: 768 },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    env: {
      // Browser fixtures make real jsonFetch calls but do not sign in. A safe
      // config lets Firebase initialize without borrowing a developer's .env.
      VITE_FIREBASE_CONFIG: '{"apiKey":"fixture-api-key","authDomain":"fixture.invalid","projectId":"fixture"}',
      VITE_ENVIRONMENT: 'production',
      VITE_DISABLE_API_LOGGING: 'true',
    },
    url: `${baseURL}/__fixtures/audio-player`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
