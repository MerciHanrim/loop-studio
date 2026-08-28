import { execSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

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

  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_SHA__: JSON.stringify(buildSha()),
    },
    plugins: [
      react(),
      ...(portable ? [viteSingleFile(), renameHtml('loop-studio.html')] : []),
    ],
    build: portable
      ? { outDir: 'dist-portable', emptyOutDir: true }
      : {},
    // `npm test` is the vitest unit suite only; the Playwright specs under e2e/
    // run via `npm run e2e`.
    test: {
      exclude: [...configDefaults.exclude, 'e2e/**'],
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
