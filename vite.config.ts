import { renameSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Three build targets share one React source:
//   vite build                    -> dist/            web deploy (relative asset paths)
//   vite build --mode portable    -> dist-portable/   one self-contained loop-studio.html
//                                                     that opens by double-click (file://)
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portable = mode === 'portable'

  return {
    base: './',
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
