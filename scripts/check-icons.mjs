// Slice-1 icon check (docs/pwa.md §P9 D1, review criteria 1-2). Runs in `checks`.
//
//   node scripts/check-icons.mjs
//
// Locks ALL FOUR required icon files:
//   - manifest `any`      192x192  — transparent (edge-to-edge)
//   - manifest `any`      512x512  — transparent (edge-to-edge)
//   - manifest `maskable` 512x512  — SEPARATE image, opaque field, mark in the
//                                    safe zone (byte-different from the 512 `any`)
//   - <link apple-touch>  180x180  — fully opaque (iOS renders alpha as black)
//
// For each: the file exists, is a real PNG of exactly the declared size, meets
// its alpha condition, and is referenced by the manifest object / index.html.

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { manifest } from '../src/pwa/manifest.ts'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

/** parse an 8-bit RGBA PNG → { w, h, at(x,y), everyPixel(fn) } */
function readPng(buf) {
  if (buf.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('not a PNG')
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('not 8-bit RGBA')
  let o = 8
  let idat = Buffer.alloc(0)
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(o + 8, o + 8 + len)])
    o += 12 + len
  }
  const raw = inflateSync(idat)
  const stride = w * 4
  const at = (x, y) => {
    const row = y * (stride + 1) + 1 // +1 skips the per-row filter byte
    return [raw[row + x * 4], raw[row + x * 4 + 1], raw[row + x * 4 + 2], raw[row + x * 4 + 3]]
  }
  return {
    w,
    h,
    at,
    minAlpha() {
      let m = 255
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m = Math.min(m, at(x, y)[3])
      return m
    },
  }
}

const isField = (px) => px[0] === 240 && px[1] === 239 && px[2] === 234 // #f0efea

function loadPng(relPath, expected) {
  let buf
  try {
    buf = readFileSync(resolve(root, 'public', relPath))
  } catch {
    fail(`missing icon file: public/${relPath}`)
    return null
  }
  let png
  try {
    png = readPng(buf)
  } catch (e) {
    fail(`public/${relPath}: ${e.message}`)
    return null
  }
  if (`${png.w}x${png.h}` !== expected) {
    fail(`public/${relPath}: ${png.w}x${png.h}, expected ${expected}`)
    return null
  }
  return { buf, png }
}

// ── manifest icons: exactly the three independent entries ────────────────
const want = [
  { purpose: 'any', sizes: '192x192', src: 'icons/icon-192.png' },
  { purpose: 'any', sizes: '512x512', src: 'icons/icon-512.png' },
  { purpose: 'maskable', sizes: '512x512', src: 'icons/icon-maskable-512.png' },
]
if (manifest.icons.length !== want.length) {
  fail(`manifest.icons has ${manifest.icons.length} entries, expected ${want.length}`)
}
for (const w of want) {
  const before = failed
  const entry = manifest.icons.find((i) => i.purpose === w.purpose && i.sizes === w.sizes)
  if (!entry) {
    fail(`manifest is missing an independent entry: ${w.purpose} ${w.sizes}`)
    continue
  }
  if (entry.src !== w.src) fail(`manifest ${w.purpose} ${w.sizes} src = ${entry.src}, expected ${w.src}`)
  if (entry.type !== 'image/png') fail(`manifest ${entry.src} type = ${entry.type}`)
  const loaded = loadPng(w.src, w.sizes)
  if (!loaded) continue
  const corner = loaded.png.at(3, 3)[3]
  if (w.purpose === 'any' && corner !== 0) fail(`${w.src}: corner alpha ${corner}, expected 0 (edge-to-edge / transparent)`)
  if (w.purpose === 'maskable' && corner !== 255) fail(`${w.src}: corner alpha ${corner}, expected 255 (opaque field)`)
  if (failed === before) ok(`${w.src} — ${w.sizes} PNG, purpose "${w.purpose}", alpha ok`)
}

// ── the 512 any and the 512 maskable are genuinely different images ──────
const a = loadPng('icons/icon-512.png', '512x512')
const m = loadPng('icons/icon-maskable-512.png', '512x512')
if (a && m) {
  if (a.buf.equals(m.buf)) fail('icon-512 and icon-maskable-512 are the SAME file — compose the maskable icon separately')
  else ok('plain 512 and maskable 512 are different images')
  // the mark must sit INSIDE the safe zone: a non-field pixel at r≈62% and a
  // clean field near the edge
  if (isField(m.png.at(256 + 119, 256))) fail('maskable: no mark near r≈62% — drawn in the safe zone?')
  else ok('maskable: mark visible inside the safe zone')
  if (!isField(m.png.at(20, 256))) fail('maskable: mark reaches the icon edge — safe zone too small')
  else ok('maskable: field is clean at the edge (safe zone respected)')
}

// ── apple-touch-icon: referenced by index.html, 180x180, FULLY opaque ────
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const touchRef = html.match(/<link[^>]+rel=["']?apple-touch-icon["']?[^>]*href=["']([^"']+)["']/i)
if (!touchRef) {
  fail('index.html has no <link rel="apple-touch-icon" href="...">')
} else {
  const href = touchRef[1].replace(/^\//, '') // "/icons/apple-touch-icon.png" → "icons/..."
  ok(`index.html references apple-touch-icon: ${touchRef[1]}`)
  const t = loadPng(href, '180x180')
  if (t) {
    const minA = t.png.minAlpha()
    if (minA !== 255) fail(`${href}: has transparency (min alpha ${minA}) — iOS renders alpha as black; must be fully opaque`)
    else ok(`${href} — 180x180 PNG, fully opaque`)
  }
}

// ── index.html: light + dark theme-color ────────────────────────────────
const themeLight = /<meta[^>]+name=["']?theme-color["']?[^>]*media=["'][^"']*light[^"']*["'][^>]*content=["']#f0efea["']/i
const themeDark = /<meta[^>]+name=["']?theme-color["']?[^>]*media=["'][^"']*dark[^"']*["'][^>]*content=["']#171a18["']/i
if (themeLight.test(html)) ok('index.html: light theme-color #f0efea')
else fail('index.html: missing light theme-color #f0efea')
if (themeDark.test(html)) ok('index.html: dark theme-color #171a18')
else fail('index.html: missing dark theme-color #171a18')

if (failed) {
  console.error('\nicon check FAILED')
  process.exit(1)
}
console.log('\nicon check passed (192 / 512 / maskable-512 / apple-touch-180 all locked)')
