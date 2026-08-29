import { defineConfig, devices } from '@playwright/test'

// The `--mode pwa` build (with the service worker), served by a small
// generation-switching backend (`e2e/support/pwa-serve.mjs`) at
// http://localhost:4174. It pre-builds THREE generations (stamps pwagenA/B/C)
// so the update tests switch generations without rebuilding mid-run — safe
// under retries. `PWA_TEST_ORIGIN` is baked as http://localhost:4174, so
// `registerPwa()` allows that origin but NOT http://127.0.0.1:4174 (the
// registration-gate test). Run: `npm run e2e:pwa`.

const PREVIEW = 'http://localhost:4174'

export default defineConfig({
  testDir: './e2e',
  testMatch: /pwa\.spec\.ts/,
  fullyParallel: false, // tests share one backend whose "current generation" is global state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PREVIEW,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'pwa',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'node e2e/support/pwa-serve.mjs',
    url: PREVIEW,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000, // 3 `vite build` passes up front
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
