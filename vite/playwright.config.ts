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
    url: 'http://127.0.0.1:5192/__fixtures/audio-player',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
