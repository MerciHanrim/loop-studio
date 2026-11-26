// Mobile breakpoint — single source of truth (docs/mobile.md §MV2 / §MV-D1).
// Runs in `checks`.
//
//   node scripts/check-mobile-query.mjs
//
// The `@media` block in src/index.css and the JS `MOBILE_MEDIA_QUERY` in
// src/ui/media.ts (used by useIsMobile) MUST be the exact same query string.
// CSS cannot import the constant, so this guards the two from drifting.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { MOBILE_MEDIA_QUERY } from '../src/ui/media.ts'

// LOOP_CHECK_ROOT: tests only (scripts/check-scripts-scope.test.mjs) — a copy of the tree
const root = process.env.LOOP_CHECK_ROOT ?? resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')

const needle = `@media ${MOBILE_MEDIA_QUERY} {`
if (css.includes(needle)) {
  ok(`src/index.css @media block matches MOBILE_MEDIA_QUERY`)
} else {
  fail(`src/index.css has no "@media ${MOBILE_MEDIA_QUERY} {" block`)
}

// issue #621 item 6 — every stylesheet under src/, not src/index.css alone:
// `workbench.css` and `nodeStructure.css` carry @media blocks of their own.
const stylesheets = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.css$/.test(e.name)) stylesheets.push(relative(root, p).split(sep).join('/'))
  }
}
walk(resolve(root, 'src'))
if (!stylesheets.includes('src/index.css')) fail('src/index.css was not found by the stylesheet walk - the reader is broken')

// Every width-driven @media block must be the shared query — nothing else may
// introduce a second breakpoint behind Loop Studio's back.
let stray = 0
for (const rel of stylesheets.sort()) {
  const text = readFileSync(resolve(root, rel), 'utf8')
  for (const m of text.matchAll(/@media ([^{]+){/g)) {
    const q = m[1].trim()
    const allowed =
      q === MOBILE_MEDIA_QUERY ||
      q.includes('prefers-color-scheme') ||
      q.includes('prefers-reduced-motion') ||
      q.includes('forced-colors')
    if (allowed) continue
    stray++
    fail(`unexpected @media query in ${rel}: ${q}`)
  }
}
if (stray === 0) ok(`${stylesheets.length} stylesheet(s) under src/ use no other breakpoint`)

if (failed) {
  console.error('\ncheck-mobile-query: FAILED')
  process.exit(1)
}
console.log('\ncheck-mobile-query: ok')
