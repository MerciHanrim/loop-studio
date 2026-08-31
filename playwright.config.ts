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
      // playwright.dist.config.ts (production build + `vite preview`); mobile.spec
      // runs under the `mobile` project (small viewport + touch)
      testIgnore: [
        /portable-file\.spec\.ts/,
        /dist\.spec\.ts/,
        /pwa\.spec\.ts/,
        /mobile\.spec\.ts/,
      ],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // docs/mobile.md §MV10 — the mobile View/Run layout, at iPhone-class
      // portrait (390x844) and landscape (844x390), touch + coarse pointer.
      name: 'mobile',
      // mobile.spec.ts + the acceptance specs that must run under BOTH the
      // desktop (`chromium`) and the mobile viewport
      testMatch: /(mobile\.spec|canvas-refresh-visual\.spec|model-verification\.spec|timeline-end-labels\.spec)\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
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
