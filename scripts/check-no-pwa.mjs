// docs/pwa.md §P8.2(b) — the INVERSE check. A plain `npm run build` and the
// portable build must carry nothing PWA: no service worker, no manifest, no
// manifest link, no registration code. Run after those builds:
//
//   npm run build && npm run build:portable && node scripts/check-no-pwa.mjs
//
// (The precache-reference-closure check for the *PWA* build lands with Slice 2.)

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const walk = (dir) => {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const SW_NAME = /(?:^|[\\/])(sw|workbox-[\w-]+)\.js$/
const REG_CODE = /serviceWorker\.register|registerSW|virtual:pwa-register|workbox/i
const MANIFEST_LINK = /<link[^>]+rel=["']?manifest/i

for (const [label, dir] of [
  ['plain build (dist/)', resolve(root, 'dist')],
  ['portable build (dist-portable/)', resolve(root, 'dist-portable')],
]) {
  if (!existsSync(dir)) {
    fail(`${label}: ${dir} not found — build it first`)
    continue
  }
  const files = walk(dir)
  const rel = (f) => relative(dir, f)

  const check = (bad, badMsg, okMsg) => {
    if (bad.length) fail(`${label}: ${badMsg(bad)}`)
    else ok(`${label}: ${okMsg}`)
  }

  check(
    files.filter((f) => SW_NAME.test(f)),
    (b) => `service-worker file(s): ${b.map(rel).join(', ')}`,
    'no sw.js / workbox-*.js',
  )
  check(
    files.filter((f) => f.endsWith('manifest.webmanifest')),
    () => 'manifest.webmanifest present',
    'no manifest.webmanifest',
  )
  check(
    files.filter((f) => f.endsWith('.html')).filter((f) => MANIFEST_LINK.test(readFileSync(f, 'utf8'))),
    (b) => `<link rel="manifest"> in ${b.map(rel).join(', ')}`,
    'no <link rel="manifest"> in HTML',
  )
  check(
    files.filter((f) => f.endsWith('.js')).filter((f) => REG_CODE.test(readFileSync(f, 'utf8'))),
    (b) => `SW-registration code in ${b.map(rel).join(', ')}`,
    'no SW-registration code in emitted JS',
  )
}

if (failed) {
  console.error('\nno-PWA check FAILED')
  process.exit(1)
}
console.log('\nno-PWA check passed')
