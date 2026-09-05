import { execSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { manifest } from './src/pwa/manifest.ts'

const appVersion: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version

/** Short commit SHA: CI env first (CF Pages / GitHub Actions), then local git, else ''. */
function buildSha(): string {
  const env = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA
  if (env) return env.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

// Three build targets share one React source:
//   vite build                    -> dist/            web deploy (relative asset paths)
//   vite build --mode portable    -> dist-portable/   one self-contained loop-studio.html
//                                                     that opens by double-click (file://)
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portable = mode === 'portable'
  // The PWA layer (manifest + service worker + our registration call) belongs
  // ONLY to the Cloudflare Production build (`CF_PAGES_BRANCH === 'main'`) and
  // the dedicated `--mode pwa` test build — never a plain `npm run build`, dev,
  // or portable (docs/pwa.md §P7 / §P9 D8a). Both paths flip this one flag.
  const pwa = !portable && (mode === 'pwa' || process.env.CF_PAGES_BRANCH === 'main')

  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_SHA__: JSON.stringify(buildSha()),
      // A share link must open for its recipient, so its base is a fixed PUBLIC
      // address — never `location` (which is `null` on file://, or a localhost /
      // Preview host that no one else can reach). Overridable per deploy.
      __SHARE_BASE_URL__: JSON.stringify(
        process.env.VITE_SHARE_BASE_URL ?? 'https://cozy-loop-studio.pages.dev/',
      ),
      __PWA_ENABLED__: JSON.stringify(pwa),
      // A build-time constant, NOT a window global — a Production bundle inlines
      // this to '' so there is no runtime hook to widen the origin allow-list
      // (§P7). Non-empty only for `--mode pwa` with PWA_TEST_ORIGIN set.
      __PWA_TEST_ORIGIN__: JSON.stringify(
        pwa && mode === 'pwa' ? (process.env.PWA_TEST_ORIGIN ?? '') : '',
      ),
    },
    plugins: [
      react(),
      ...(portable ? [viteSingleFile(), renameHtml('loop-studio.html')] : []),
      // Emits `sw.js` (Workbox generateSW) + `manifest.webmanifest` and injects
      // `<link rel="manifest">`. `injectRegister: false` — we call
      // `navigator.serviceWorker.register` ourselves, dual-gated (§P7). The SW
      // never `skipWaiting`s / `clientsClaim`s on its own (§P4).
      ...(pwa
        ? [
            VitePWA({
              registerType: 'prompt',
              injectRegister: false,
              manifest,
              manifestFilename: 'manifest.webmanifest',
              includeManifestIcons: false, // the `icons/*.png` glob already covers them
              workbox: {
                globPatterns: [
                  'index.html',
                  'assets/*.{js,css}',
                  'assets/*.{woff,woff2}', // the CSS @font-face lists both — precache both
                  'manifest.webmanifest',
                  'icons/*.png',
                ],
                globIgnores: ['**/*.map', '**/*.LICENSE.txt'],
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                cleanupOutdatedCaches: true,
                navigateFallback: 'index.html',
                skipWaiting: false,
                clientsClaim: false,
              },
            }),
          ]
        : []),
    ],
    build: portable
      ? { outDir: 'dist-portable', emptyOutDir: true }
      : mode === 'pwa'
        ? { outDir: 'dist-pwa', emptyOutDir: true } // the `--mode pwa` test build; Production still emits dist/
        : {},
    // `npm test` is the vitest unit suite only; the Playwright specs under e2e/
    // run via `npm run e2e`.
    test: {
      // Robust to nested worktree checkouts under .claude/worktrees/, which
      // otherwise leak their own e2e/ Playwright specs into this glob.
      exclude: [...configDefaults.exclude, 'e2e/**', '**/.claude/worktrees/**'],
    },
  }
})

/** After the single-file bundle is written, give it a product name. */
function renameHtml(to: string): Plugin {
  return {
    name: 'loop-studio:rename-portable-html',
    enforce: 'post',
    closeBundle() {
      const dir = resolve(import.meta.dirname, 'dist-portable')
      try {
        renameSync(resolve(dir, 'index.html'), resolve(dir, to))
      } catch {
        /* nothing to rename */
      }
    },
  }
}
