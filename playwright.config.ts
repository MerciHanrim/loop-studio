import { defineConfig, devices } from '@playwright/test'

// Browser E2E for Loop Studio.
//   chromium       — http dev server (real Workers, the store bridge)
//   build-portable — one-shot `npm run build:portable`
//   portable       — the built single file opened from file:// (cooperative path,
//                    no dev server, no bridge); depends on build-portable

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // the specs share one dev server + a single graph document
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    // OS font rendering differs; only the two approved Distribution snapshots
    // are compared, and with a small tolerance.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // portable-file runs under the `portable` project; dist.spec runs under
      // playwright.dist.config.ts (production build + `vite preview`)
      testIgnore: [/portable-file\.spec\.ts/, /dist\.spec\.ts/, /pwa\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'build-portable',
      testMatch: /portable\.setup\.ts/,
    },
    {
      name: 'portable',
      testMatch: /portable-file\.spec\.ts/,
      dependencies: ['build-portable'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: undefined },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
