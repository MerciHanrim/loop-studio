// docs/pwa.md §P8.2(a) — precache REFERENCE CLOSURE, against a PWA build.
//
//   npm run build:pwa && node scripts/check-pwa-closure.mjs            # dist-pwa/
//   CF_PAGES_BRANCH=main npm run build && node scripts/check-pwa-closure.mjs dist
//
// Walks the whole local reference graph:
//
//   index.html → <script>/<link>/<img>/modulepreload
//              → each referenced CSS  → its url(...)  → font / image
//              → each referenced JS   → "assets/…" / "icons/…" string refs
//                                       (the dynamic-import MC worker, lazy chunks)
//   manifest.webmanifest → icons[].src
//
// Every LOCAL ref (external URLs, data:, blob: skipped) must be present in BOTH
// the Workbox precache list (in sw.js) AND on disk. `sw.js` / `workbox-*.js`
// are the service worker itself and are exempt from the "must be precached" rule.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { posix, relative, resolve } from 'node:path'
import { LOCALE_CHUNK_RE } from './locale-chunk.mjs'

const dir = resolve(process.cwd(), process.argv[2] ?? 'dist-pwa')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const abs = (p) => resolve(dir, p)
const isExternal = (u) => /^(?:[a-z]+:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')
/** normalise a ref to a dir-relative POSIX path ("./a/b" | "/a/b" | "a/b" → "a/b") */
const norm = (u, fromFile) => {
  const noQuery = u.split(/[?#]/)[0]
  if (!noQuery) return null
  const base = fromFile ? posix.dirname(relative(dir, fromFile).split('\\').join('/')) : '.'
  const joined = noQuery.startsWith('/') ? noQuery.slice(1) : posix.normalize(posix.join(base, noQuery))
  return joined.replace(/^\.\//, '')
}

// ── required PWA outputs ───────────────────────────────────────────────
for (const f of ['sw.js', 'manifest.webmanifest']) {
  if (existsSync(abs(f))) ok(`${f} present`)
  else fail(`${f} missing in ${relative(process.cwd(), dir)}/`)
}
if (!existsSync(abs('index.html'))) fail('index.html missing')
const indexHtml = existsSync(abs('index.html')) ? readFileSync(abs('index.html'), 'utf8') : ''
if (/<link[^>]+rel=["']?manifest/i.test(indexHtml)) ok('index.html links the manifest')
else fail('index.html has no <link rel="manifest">')

// ── the Workbox precache list ─────────────────────────────────────────
const sw = existsSync(abs('sw.js')) ? readFileSync(abs('sw.js'), 'utf8') : ''
const precache = new Set(
  [...sw.matchAll(/\{\s*url:\s*"([^"]+)"/g)].map((m) => norm(m[1])),
)
if (precache.size === 0) fail('could not read a precache list from sw.js')
else ok(`precache list: ${precache.size} entries`)

// ── walk the reference graph ─────────────────────────────────────────
const SW_SELF = /(?:^|\/)(sw|workbox-[\w-]+)\.js$/
const seen = new Set()
const queue = []
const enqueue = (ref, fromFile) => {
  if (!ref || isExternal(ref)) return
  const rel = norm(ref, fromFile)
  if (!rel || seen.has(rel)) return
  seen.add(rel)
  queue.push(rel)
}

// roots: index.html + manifest icons
for (const m of indexHtml.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) enqueue(m[1], abs('index.html'))
if (existsSync(abs('manifest.webmanifest'))) {
  try {
    const mani = JSON.parse(readFileSync(abs('manifest.webmanifest'), 'utf8'))
    for (const icon of mani.icons ?? []) enqueue(icon.src, abs('manifest.webmanifest'))
  } catch {
    fail('manifest.webmanifest is not valid JSON')
  }
}

while (queue.length) {
  const rel = queue.shift()
  const file = abs(rel)

  if (!existsSync(file)) {
    fail(`referenced file does not exist on disk: ${rel}`)
    continue
  }
  if (SW_SELF.test(rel)) {
    // the service worker itself — not precached, expected
  } else if (LOCALE_CHUNK_RE.test(rel)) {
    // docs/pwa.md §P8 — a lazily-loaded locale chunk: deliberately NOT
    // precached, served by the `loop-locale-chunks` CacheFirst route.
    if (precache.has(rel)) fail(`locale chunk should be runtime-cached, not precached: ${rel}`)
    else ok(`${rel} (runtime-cached)`)
  } else if (!precache.has(rel)) {
    fail(`referenced file is NOT precached: ${rel}`)
  }

  if (rel.endsWith('.css')) {
    const css = readFileSync(file, 'utf8')
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) enqueue(m[1], file)
  } else if (rel.endsWith('.js')) {
    const js = readFileSync(file, 'utf8')
    for (const m of js.matchAll(/["'`](?:\.\/)?((?:assets|icons)\/[\w.-]+\.(?:js|css|woff2?|png|svg|json))["'`]/gi)) {
      enqueue(m[1], abs('.')) // asset paths in JS are dir-root-relative
    }
  }
}

// ── app-shell inclusion / exclusion (not a brittle count) ────────────
// Every essential the app needs to boot offline MUST be precached; no locale
// chunk may be (docs/pwa.md §P8).
const listDir = (d) => (existsSync(abs(d)) ? readdirSync(abs(d)).map((f) => `${d}/${f}`) : [])
const assetFiles = listDir('assets')
const shellEssentials = [
  'index.html',
  'manifest.webmanifest',
  ...assetFiles.filter((f) => /^assets\/index-[\w-]+\.(js|css)$/.test(f)),
  ...assetFiles.filter((f) => /\.woff2?$/.test(f)),
  ...listDir('icons').filter((f) => f.endsWith('.png')),
]
for (const f of new Set(shellEssentials)) {
  if (precache.has(f)) ok(`app-shell precached: ${f}`)
  else fail(`app-shell essential NOT precached: ${f}`)
}
const strayLocale = [...precache].filter((p) => LOCALE_CHUNK_RE.test(p))
if (strayLocale.length) fail(`locale chunk(s) in the precache list: ${strayLocale.join(', ')}`)
else ok('no locale chunk is precached')

if (failed) {
  console.error('\nprecache closure FAILED')
  process.exit(1)
}
console.log(`\nprecache closure passed — app shell precached, locale chunks runtime-cached`)
