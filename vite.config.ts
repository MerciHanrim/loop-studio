import { execSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { manifest } from './src/pwa/manifest.ts'
import { LOCALE_CHUNK_RE } from './scripts/locale-chunk.mjs'

// docs/localization.md §L4.5 — each non-`en` UI catalog and template-label dict
// is its own chunk (`assets/locale-<code>-<hash>.js` /
// `assets/tmpl-labels-<code>-<hash>.js`) so the PWA can runtime-cache them
// instead of precaching every language. `<code>` may carry a script subtag
// (`zh-Hans`) — keep the segment permissive.
function localeChunkOf(id: string): string | undefined {
  const path = id.replace(/\\/g, '/')
  const ui = /\/src\/i18n\/locales\/([^/]+)\//.exec(path)
  if (ui && ui[1] !== 'en') return `locale-${ui[1]}`
  const tl = /\/src\/i18n\/templateLabels\/([^/]+)\.ts$/.exec(path)
  if (tl && !/^(index|relabel|dicts|known\.generated)$/.test(tl[1]) && !tl[1].endsWith('.test')) {
    return `tmpl-labels-${tl[1]}`
  }
  return undefined
}

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
                // docs/localization.md §L4.5 / docs/pwa.md §P8 — the per-locale
                // catalog + template-label chunks are NOT precached; they are
                // `CacheFirst` runtime-cached, fetched on first use.
                globIgnores: [
                  '**/*.map',
                  '**/*.LICENSE.txt',
                  'assets/locale-*.js',
                  'assets/tmpl-labels-*.js',
                ],
                runtimeCaching: [
                  {
                    // Pass the RegExp itself — `generateSW` serialises
                    // `runtimeCaching` into `sw.js`, so a callback that closed
                    // over an imported const would lose the reference. The
                    // pattern matches a full request URL as well as a pathname.
                    urlPattern: LOCALE_CHUNK_RE,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'loop-locale-chunks',
                      expiration: { maxEntries: 24 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
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
      ? { outDir: 'dist-portable', emptyOutDir: true } // viteSingleFile inlines everything — no manual chunks
      : {
          // docs/localization.md §L4.5 — split each non-`en` UI catalog and
          // template-label dict into its own stably-named chunk.
          rollupOptions: {
            output: { manualChunks: (id: string) => localeChunkOf(id) },
          },
          ...(mode === 'pwa' ? { outDir: 'dist-pwa', emptyOutDir: true } : {}),
        },
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
