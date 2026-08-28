import { defineConfig, devices } from '@playwright/test'

// Verifies the PRODUCTION build the way Cloudflare Pages serves it:
// `npm run build` → `dist/` → `vite preview` at the domain root `/`.
// Kept in its own config so the fast dev loop (`npm run e2e`) never pays for a
// full build. Run with `npm run e2e:dist`.

const PREVIEW_URL = 'http://localhost:4173'

export default defineConfig({
  testDir: './e2e',
  testMatch: /dist\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PREVIEW_URL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'dist',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
