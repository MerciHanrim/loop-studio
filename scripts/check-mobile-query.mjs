// Mobile breakpoint — single source of truth (docs/mobile.md §MV2 / §MV-D1).
// Runs in `checks`.
//
//   node scripts/check-mobile-query.mjs
//
// The `@media` block in src/index.css and the JS `MOBILE_MEDIA_QUERY` in
// src/ui/media.ts (used by useIsMobile) MUST be the exact same query string.
// CSS cannot import the constant, so this guards the two from drifting.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOBILE_MEDIA_QUERY } from '../src/ui/media.ts'

const root = resolve(import.meta.dirname, '..')
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

// Every width-driven @media block must be the shared query — nothing else may
// introduce a second breakpoint behind Loop Studio's back.
for (const m of css.matchAll(/@media ([^{]+){/g)) {
  const q = m[1].trim()
  const allowed =
    q === MOBILE_MEDIA_QUERY ||
    q.includes('prefers-color-scheme') ||
    q.includes('prefers-reduced-motion')
  if (allowed) continue
  fail(`unexpected @media query in src/index.css: ${q}`)
}

if (failed) {
  console.error('\ncheck-mobile-query: FAILED')
  process.exit(1)
}
console.log('\ncheck-mobile-query: ok')
